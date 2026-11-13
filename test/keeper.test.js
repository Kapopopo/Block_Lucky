// Test de bout en bout du robot de clôture du serveur (rôle de Chainlink Automation en local) :
// une vraie blockchain Ganache, l'usine déployée, un tirage échu… et la surveillance qui fait le reste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonRpcProvider, ContractFactory, Contract, ZeroHash, parseEther } from 'ethers';
import { compile } from '../scripts/compile.js';
import { createChainService } from '../server/chain.js';

const compiled = compile();
const Status = { Open: 0n, Drawing: 1n, Settled: 2n };

test('robot de clôture : à l’échéance, le serveur demande le tirage, l’oracle simulé répond, un gagnant est désigné', async t => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const server = ganache.server({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { deterministic: true } });
  await server.listen(port);
  t.after(() => server.close());
  const rpcUrl = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  t.after(() => provider.destroy());
  const [owner, alice] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);
  const deploy = async (name, ...args) => {
    const contract = await new ContractFactory(compiled[name].abi, compiled[name].evm.bytecode.object, owner).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };

  const mock = await deploy('VRFCoordinatorMock');
  const factory = await deploy('BlockLuckyFactory', await mock.getAddress(), ZeroHash, 0, true);
  await (await factory.createLottery(60, 10, 5)).wait();
  const lottery = new Contract((await factory.lotteries())[0], compiled.BlockLucky.abi, alice);
  await (await lottery.buyTickets(2, { value: parseEther('.02') })).wait();

  const dir = mkdtempSync(path.join(tmpdir(), 'blocklucky-keeper-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const contractFile = path.join(dir, 'contract.json');
  writeFileSync(contractFile, JSON.stringify({
    network: 'local', chainId: 31337, rpcUrl, deployBlock: 0, owner: await owner.getAddress(), factory: await factory.getAddress(),
    vrf: { mode: 'mock', coordinator: await mock.getAddress() },
    abi: { factory: compiled.BlockLuckyFactory.abi, lottery: compiled.BlockLucky.abi, coordinator: compiled.VRFCoordinatorMock.abi },
  }));
  const messages = [];
  const chain = createChainService({ contractFile, env: { FAUCET_ACCOUNT_INDEX: '9' }, log: { log: m => messages.push(m), warn: m => messages.push(m) } });
  assert.equal(chain.autoCloseEnabled(), true);

  await chain.tick(); // ventes encore ouvertes : rien à faire
  assert.equal(await lottery.status(), Status.Open);

  await provider.send('evm_increaseTime', [61]);
  await provider.send('evm_mine', []);
  await chain.tick(); // échéance passée : le serveur exécute performUpkeep, puis voit la demande à l'oracle
  assert.equal(await lottery.status(), Status.Drawing);
  await new Promise(resolve => setTimeout(resolve, 3500)); // l'oracle simulé « réfléchit » 2,5 s
  assert.equal(await lottery.status(), Status.Settled, messages.join('\n'));
  assert.equal(await lottery.winner(), await alice.getAddress());
  assert.ok(messages.some(m => m.includes('Clôture automatique')), messages.join('\n'));
});
