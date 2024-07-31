import { expect } from 'chai';
import { DeployHelper } from '../scripts/deployHelpers';
import { TestERC20 } from '../typechain';

describe('DeployHelpers', () => {
    let deployHelper: DeployHelper;

    beforeEach(async () => {
        deployHelper = new DeployHelper();
        deployHelper.silent = true;
    });

    it('Deploy', async () => {
        // deploy
        const con: TestERC20 = await deployHelper.deploy(
            'ERC20',
            'ERC20',
            async () => await (await ethers.getContractFactory('TestERC20')).deploy('TEST', 'Test')
        );

        // check
        expect(await con.symbol()).to.be.equal('TEST');
    });
});
