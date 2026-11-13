// Compile tous les contrats Solidity du dossier contracts/ avec solc (sans outil externe).
import solc from 'solc';
import { readFileSync, readdirSync } from 'node:fs';

const CONTRACTS_DIR = new URL('../contracts/', import.meta.url);

/** @returns {{ BlockLucky, BlockLuckyFactory, VRFCoordinatorMock }} ABI + bytecode de chaque contrat. */
export function compile() {
  const sources = {};
  for (const name of readdirSync(CONTRACTS_DIR).filter(file => file.endsWith('.sol'))) {
    sources[name] = { content: readFileSync(new URL(name, CONTRACTS_DIR), 'utf8') };
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
    },
  };
  // Les imports « ./Fichier.sol » sont résolus dans le dossier contracts/.
  const findImports = path => {
    try { return { contents: readFileSync(new URL(path.replace(/^\.\//, ''), CONTRACTS_DIR), 'utf8') }; }
    catch { return { error: `Fichier introuvable : ${path}` }; }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = output.errors?.filter(e => e.severity === 'error');
  if (errors?.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));

  const contracts = {};
  for (const file of Object.values(output.contracts)) Object.assign(contracts, file);
  return contracts;
}
