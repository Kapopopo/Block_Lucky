// Tests des smart contracts sur une blockchain Ganache éphémère, avec l'imitation locale de l'oracle VRF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, Contract, parseEther, ZeroHash, AbiCoder } from 'ethers';
import { compile } from '../scripts/compile.js';

const compiled = compile();
const deploy = async (name, signer, ...args) => {
  const { abi, evm } = compiled[name];
  const contract = await new ContractFactory(abi, evm.bytecode.object, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
};
/** Vérifie qu'une transaction est refusée, et pour la bonne raison (message `require` du contrat). */
async function rejectsTx(action, reason) {
  try {
    const tx = await action();
    await tx.wait();
  } catch (error) {
    if (reason) assert.match([error.reason, error.shortMessage, error.message].join(' '), new RegExp(reason));
    return;
  }
  assert.fail(`La transaction aurait dû être refusée${reason ? ` (${reason})` : ''}.`);
}
const mined = async action => (await action()).wait();

/**
 * Ganache, utilisé en mémoire, renvoie les refus dans un format que ethers ne décode pas.
 * Cet adaptateur les remet au format des nœuds Ethereum (code 3 + données du refus).
 */
function withRevertData(rpc) {
  return {
    request: async args => {
      try {
        return await rpc.request(args);
      } catch (error) {
        const data = typeof error.data === 'string' ? error.data : error.data?.result ?? error.data?.data;
        throw Object.assign(new Error(error.message), { code: 3, data });
      }
    },
  };
}

/** Déploie l'oracle simulé, l'usine et un premier tirage. */
async function setup(t, { capacity = 3, perPlayer = 3, duration = 3600 } = {}) {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', vmErrorsOnRPCResponse: true } });
  t.after(() => rpc.disconnect());
  const provider = new BrowserProvider(withRevertData(rpc));
  const [owner, alice, bob] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
  const mock = await deploy('VRFCoordinatorMock', owner);
  const factory = await deploy('BlockLuckyFactory', owner, await mock.getAddress(), ZeroHash, 0, true);
  await mined(() => factory.createLottery(duration, capacity, perPlayer));
  const lottery = new Contract((await factory.lotteries())[0], compiled.BlockLucky.abi, owner);
  const as = signer => lottery.connect(signer);
  const fulfill = async word => { const id = await lottery.requestId(); return mined(() => mock.fulfillRandomWords(id, word)); };
  return { rpc, provider, owner, alice, bob, mock, factory, lottery, as, fulfill };
}

const Status = { Open: 0n, Drawing: 1n, Settled: 2n, Cancelled: 3n };

test('contrat : paiement exact, quantités et limite par joueur', async t => {
  const { lottery, alice } = await setup(t, { capacity: 10, perPlayer: 3 });
  await rejectsTx(() => lottery.connect(alice).buyTickets(1, { value: parseEther('.02') }), 'Wrong payment');
  await rejectsTx(() => lottery.connect(alice).buyTickets(0), 'Invalid quantity');
  await mined(() => lottery.connect(alice).buyTickets(2, { value: parseEther('.02') }));
  await rejectsTx(() => lottery.connect(alice).buyTickets(2, { value: parseEther('.02') }), 'Player limit reached');
  await mined(() => lottery.connect(alice).buyTickets(1, { value: parseEther('.01') }));
  assert.equal(await lottery.ticketCount(await alice.getAddress()), 3n);
});

test('contrat : capacité atteinte → demande à l’oracle → gagnant → retrait unique', async t => {
  const { provider, lottery, alice, bob, fulfill, as } = await setup(t, { capacity: 3, perPlayer: 2 });
  await mined(() => as(alice).buyTickets(2, { value: parseEther('.02') }));
  await mined(() => as(bob).buyTickets(1, { value: parseEther('.01') }));
  assert.equal(await lottery.status(), Status.Drawing);
  assert.ok(await lottery.requestId() > 0n);
  await rejectsTx(() => as(bob).buyTickets(1, { value: parseEther('.01') }), 'Sales closed');

  const word = 12345678901234567890n; // 12345678901234567890 % 3 = 0 → ticket n° 1 (alice)
  await fulfill(word);
  assert.equal(await lottery.status(), Status.Settled);
  assert.equal(await lottery.randomWord(), word);
  assert.equal(await lottery.winningTicket(), word % 3n + 1n);
  assert.equal(await lottery.winner(), await alice.getAddress());
  assert.equal(await lottery.credits(await alice.getAddress()), parseEther('.03'));

  await rejectsTx(() => as(bob).withdraw(), 'Nothing to withdraw');
  await mined(() => as(alice).withdraw());
  await rejectsTx(() => as(alice).withdraw(), 'Nothing to withdraw');
  assert.equal(await provider.getBalance(await lottery.getAddress()), 0n);
});

test('contrat : seul le coordinateur VRF peut fournir le hasard', async t => {
  const { factory, lottery, alice, as } = await setup(t, { capacity: 1, perPlayer: 1 });
  await mined(() => as(alice).buyTickets(1, { value: parseEther('.01') }));
  const requestId = await lottery.requestId();
  await rejectsTx(() => factory.connect(alice).rawFulfillRandomWords(requestId, [7n]), 'Only coordinator');
  await rejectsTx(() => as(alice).fulfillRandomness(requestId, 7n), 'Only factory');
  await rejectsTx(() => factory.connect(alice).requestRandomness(), 'Only lotteries');
});

test('contrat : après la date limite, n’importe qui demande le tirage', async t => {
  const { rpc, lottery, alice, bob, as } = await setup(t, { capacity: 10, perPlayer: 5 });
  await mined(() => as(alice).buyTickets(1, { value: parseEther('.01') }));
  await rejectsTx(() => as(bob).requestDraw(), 'Not ready');
  await rpc.request({ method: 'evm_increaseTime', params: [3601] });
  await rpc.request({ method: 'evm_mine', params: [] });
  await rejectsTx(() => as(bob).buyTickets(1, { value: parseEther('.01') }), 'Sales closed');
  await mined(() => as(bob).requestDraw({ gasLimit: 400000 })); // Ganache estime le gaz avec l'heure d'avant evm_increaseTime
  assert.equal(await lottery.status(), Status.Drawing);
});

test('contrat : l’admin annule, chacun est remboursé une seule fois, en une seule transaction', async t => {
  const { provider, lottery, alice, bob, as } = await setup(t, { capacity: 10, perPlayer: 5 });
  await mined(() => as(alice).buyTickets(2, { value: parseEther('.02') }));
  await rejectsTx(() => as(bob).cancel(), 'Not allowed');
  await mined(() => lottery.cancel()); // lottery est connecté au propriétaire
  assert.equal(await lottery.status(), Status.Cancelled);
  await rejectsTx(() => as(alice).buyTickets(1, { value: parseEther('.01') }), 'Sales closed');
  const player = await alice.getAddress();
  const receipt = await mined(() => as(alice).refund());
  // La mise revient directement sur le portefeuille : seuls les frais de la transaction sont perdus.
  // (Soldes lus à des blocs précis : ethers garde 250 ms en cache deux lectures identiques.)
  const before = await provider.getBalance(player, receipt.blockNumber - 1);
  const after = await provider.getBalance(player, receipt.blockNumber);
  assert.equal(after, before + parseEther('.02') - receipt.gasUsed * receipt.gasPrice);
  await rejectsTx(() => as(alice).refund(), 'Nothing to refund');
  assert.equal(await lottery.credits(await alice.getAddress()), 0n);
  assert.equal(await provider.getBalance(await lottery.getAddress()), 0n);
});

test('contrat : oracle muet pendant 1 h → n’importe qui peut annuler ; réponse tardive ignorée', async t => {
  const { rpc, factory, lottery, alice, bob, as, fulfill } = await setup(t, { capacity: 1, perPlayer: 1 });
  await mined(() => as(alice).buyTickets(1, { value: parseEther('.01') }));
  await rejectsTx(() => as(bob).cancel(), 'Not allowed');
  await rpc.request({ method: 'evm_increaseTime', params: [3601] });
  await rpc.request({ method: 'evm_mine', params: [] });
  await mined(() => as(bob).cancel({ gasLimit: 100000 }));
  const receipt = await fulfill(42n); // l'oracle répond trop tard : pas d'erreur, réponse ignorée
  const event = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } }).find(e => e?.name === 'RandomnessFulfilled');
  assert.equal(event.args.accepted, false);
  assert.equal(await lottery.status(), Status.Cancelled);
});

test('usine : seul l’admin crée, un tirage actif à la fois, numéros qui se suivent', async t => {
  const { rpc, factory, alice, as, fulfill } = await setup(t, { capacity: 1, perPlayer: 1 });
  await rejectsTx(() => factory.connect(alice).createLottery(3600, 10, 5), 'Only owner');
  await rejectsTx(() => factory.createLottery(3600, 10, 5), 'Current draw still active');
  await mined(() => as(alice).buyTickets(1, { value: parseEther('.01') }));
  await fulfill(1n);
  await rejectsTx(() => factory.createLottery(3600, 10, 11), 'Invalid player limit');
  await mined(() => factory.createLottery(60, 10, 5));
  const second = new Contract((await factory.lotteries())[1], compiled.BlockLucky.abi, alice);
  assert.equal(await second.round(), 2n);
  assert.equal(await second.maxTicketsPerPlayer(), 5n);
  // Un tirage échu sans aucun ticket n'est plus actif : l'admin peut en créer un autre.
  await rpc.request({ method: 'evm_increaseTime', params: [61] });
  await rpc.request({ method: 'evm_mine', params: [] });
  assert.equal(await second.isActive(), false);
  await mined(() => factory.createLottery(3600, 10, 5));
  assert.equal(await factory.lotteryCount(), 3n);
});

test('usine : la réserve de l’oracle peut être alimentée en ETH', async t => {
  const { factory } = await setup(t);
  await mined(() => factory.fundOracle({ value: parseEther('0.5') }));
  const [, native] = await factory.oracleBalance();
  assert.equal(native, parseEther('0.5'));
  await rejectsTx(() => factory.fundOracle({ value: 0 }), 'Nothing sent');
});

test('usine : chaque tirage est un clone léger, configuré une seule fois, environ 30 fois moins cher à créer', async t => {
  const { provider, factory, lottery, alice, as, fulfill } = await setup(t, { capacity: 1, perPlayer: 1 });
  assert.equal((await provider.getCode(await lottery.getAddress())).length, 2 + 45 * 2); // proxy EIP-1167 : 45 octets
  const someone = await alice.getAddress();
  await rejectsTx(() => lottery.initialize(someone, 9, 60, 10, 5), 'Already initialized'); // impossible de reconfigurer un tirage
  const model = new Contract(await factory.implementation(), compiled.BlockLucky.abi, alice);
  await rejectsTx(() => model.initialize(someone, 1, 60, 10, 5), 'Already initialized'); // le modèle est verrouillé
  await mined(() => as(alice).buyTickets(1, { value: parseEther('.01') }));
  await fulfill(3n);
  const receipt = await mined(() => factory.createLottery(3600, 10, 5));
  assert.ok(receipt.gasUsed < 400000n, `création d'un tirage : ${receipt.gasUsed} gas`);
});

test('usine : clôture automatique à l’échéance, puis annulation si l’oracle reste muet (Chainlink Automation)', async t => {
  const { rpc, provider, factory, lottery, alice, bob, as } = await setup(t, { capacity: 10, perPlayer: 5 });
  const due = async () => {
    const [needed, data] = await factory.checkUpkeep('0x');
    return needed ? Number(AbiCoder.defaultAbiCoder().decode(['uint8'], data)[0]) : 0;
  };
  const later = async seconds => { await rpc.request({ method: 'evm_increaseTime', params: [seconds] }); await rpc.request({ method: 'evm_mine', params: [] }); };
  await mined(() => as(alice).buyTickets(2, { value: parseEther('.02') }));
  assert.equal(await due(), 0); // ventes encore ouvertes
  await rejectsTx(() => factory.connect(bob).performUpkeep('0x'), 'Nothing to do');

  await later(3601);
  assert.equal(await due(), 1); // échéance passée avec des tickets : demander le hasard
  await mined(() => factory.connect(bob).performUpkeep('0x', { gasLimit: 600000 })); // n'importe qui peut l'exécuter
  assert.equal(await lottery.status(), Status.Drawing);
  assert.equal(await due(), 0);

  await later(3601);
  assert.equal(await due(), 2); // oracle muet depuis 1 h : annulation
  await mined(() => factory.connect(bob).performUpkeep('0x', { gasLimit: 300000 }));
  assert.equal(await lottery.status(), Status.Cancelled);
  await mined(() => as(alice).refund());
  assert.equal(await provider.getBalance(await lottery.getAddress()), 0n);
});
