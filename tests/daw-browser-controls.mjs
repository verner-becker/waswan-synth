// SPDX-License-Identifier: GPL-3.0-only
export async function clickDawFile(daw,name){
  await daw.getByRole('button',{name:'File',exact:true}).click();
  await daw.getByRole('button',{name,exact:true}).click();
}
