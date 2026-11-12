import solc from 'solc';
import { readFileSync } from 'node:fs';
export function compile() {
  const input = {language:'Solidity',sources:{'BlockLucky.sol':{content:readFileSync(new URL('../contracts/BlockLucky.sol',import.meta.url),'utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode']}}}};
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter(e=>e.severity==='error');
  if(errors?.length) throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
  return output.contracts['BlockLucky.sol'].BlockLucky;
}
