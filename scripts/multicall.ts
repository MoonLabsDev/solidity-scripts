import { Contract, Interface, InterfaceAbi, ContractRunner, FunctionFragment } from 'ethers';

const MULTICALL3_ABI = [
  'function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls) public returns (tuple(bool success, bytes returnData)[] returnData)',
];

export interface IEncodedCall {
  target: string;
  callData: string;
}

export interface ICall {
  target: Contract;
  functionSignature: string;
  args: any[];
  topic?: string;
}

export interface ICallWithTopic extends ICall {
  topic?: string;
}

export interface ICallWithReference {
  reference: string;
  calls: ICallWithTopic[];
}

export interface ICallWithReferenceResult {
  [reference: string]: {
    [topic: string]: any;
    [resultIndex: number]: any;
  };
}

export class Multicall {
  /////////////////
  // Attributes
  /////////////////

  private readonly contract: Contract;

  /////////////////
  // Create
  /////////////////

  public constructor(provider: ContractRunner, address: string) {
    this.contract = new Contract(address, MULTICALL3_ABI, provider);
  }

  /////////////////
  // Calls
  /////////////////

  public async rawCall(
    calls: IEncodedCall[],
    requireSuccess: boolean = true
  ): Promise<{ success: boolean; returnData: string }[]> {
    const res: { success: boolean; returnData: string }[] = await this.contract.tryAggregate.staticCall(
      requireSuccess,
      calls
    );
    return res;
  }

  public async call(calls: ICall[], requireSuccess: boolean = true): Promise<{ success: boolean; returnData: any }[]> {
    // encode calls
    const encodedCalls: IEncodedCall[] = [];
    for (const call of calls) {
      encodedCalls.push({
        target: await call.target.getAddress(),
        callData: call.target.interface.encodeFunctionData(call.functionSignature, call.args),
      });
    }

    // raw call
    const res = await this.rawCall(encodedCalls, requireSuccess);

    // decode return data
    const decodedRes: { success: boolean; returnData: any }[] = res.map((r, i) => ({
      success: r.success,
      returnData: !r.success ? null : this.decode(calls[i].target.interface, calls[i].functionSignature, r.returnData),
    }));

    return decodedRes;
  }

  public async callWithReference(
    referenceCalls: ICallWithReference[] | ICallWithReference,
    requireSuccess: boolean = true
  ): Promise<ICallWithReferenceResult> {
    // flatten references and make map
    const flattenedCalls: (ICall & {
      reference: string;
      topic?: string;
      index: number;
    })[] = [];
    const arr = Array.isArray(referenceCalls) ? referenceCalls : [referenceCalls];
    for (const reference of arr) {
      for (const call of reference.calls) {
        flattenedCalls.push({
          ...call,
          reference: reference.reference,
          topic: call.topic,
          index: flattenedCalls.length,
        });
      }
    }

    // call
    const res = await this.call(flattenedCalls, requireSuccess);

    // flatten referenced results
    const flattenedResults: ICallWithReferenceResult = {};
    for (const flatCall of flattenedCalls) {
      // extract
      const index = flatCall.index;
      const resultData = res[index];
      const reference = flatCall.reference;
      const topic = flatCall.topic;
      const result = resultData.success ? resultData.returnData : null;

      // ensure reference exists
      if (!flattenedResults[reference]) flattenedResults[reference] = {};
      const refResult = flattenedResults[reference];

      // write result
      refResult[index] = result;
      if (topic) refResult[topic] = result;
    }

    return flattenedResults;
  }

  /////////////////
  // Helpers
  /////////////////

  public static async batchIterate(
    multicall: Multicall,
    length: number,
    batchSize: number,
    references: string[],
    requireSuccess: boolean,
    callbackMakeCalls: (references: Record<string, ICallWithReference>, index: number) => Promise<any>,
    callbackProcess: (result: any, index: number) => Promise<any>,
    callbackEnd?: (start: number, end: number) => Promise<any>
  ) {
    for (let n = 0; n < length; n += batchSize) {
      // get end
      const end = Math.min(n + batchSize, length);

      // make references
      const referenceCalls: ICallWithReference[] = [];
      const referenceMap: Record<string, ICallWithReference> = {};
      references.forEach(r => {
        const rc = this.createReference(r, []);
        referenceCalls.push(rc);
        referenceMap[r] = rc;
      });

      // make calls
      for (let m = n; m < end; m++) await callbackMakeCalls(referenceMap, m);

      // multicall
      const res = await multicall.callWithReference(referenceCalls, requireSuccess);

      // process results
      for (let m = n; m < end; m++) await callbackProcess(res, m);

      // callback end
      if (callbackEnd) await callbackEnd(n, end);
    }
  }

  public static createReference(reference: string, calls: ICallWithTopic[]): ICallWithReference {
    return {
      reference: reference,
      calls: calls,
    };
  }

  public static createTopicCall(
    topic: string,
    target: Contract,
    functionSignature: string,
    args: any[]
  ): ICallWithTopic {
    return {
      target: target,
      functionSignature: functionSignature,
      args: args,
      topic: topic,
    };
  }

  public static createCall(target: Contract, functionSignature: string, args: any[]): ICallWithTopic {
    return {
      target: target,
      functionSignature: functionSignature,
      args: args,
    };
  }

  public getFunctionFromCallData(abi: Interface | InterfaceAbi, callData: string): null | FunctionFragment {
    // convert to interface
    const abiInterface = abi instanceof Interface ? abi : new Interface(abi);

    // get selector from call data
    const selector = callData.slice(0, 10);

    // get function abi
    const func = abiInterface.getFunction(selector);

    return func;
  }

  public decode(abi: Interface | InterfaceAbi, functionSignatureOrSelector: string, returnData: string): any {
    // convert to interface
    const abiInterface = abi instanceof Interface ? abi : new Interface(abi);

    // get signature & function fragment
    const signature = functionSignatureOrSelector.startsWith('0x')
      ? functionSignatureOrSelector
      : (abiInterface.getFunction(functionSignatureOrSelector)?.selector ?? '');
    const func = this.getFunctionFromCallData(abi, signature);
    if (!func) throw new Error(`Function ${functionSignatureOrSelector} not found in ABI`);

    // decode
    const decoded = abiInterface.decodeFunctionResult(func, returnData);
    const ret = decoded.length === 1 ? decoded[0] : decoded; // unwrap
    return ret;
  }
}
