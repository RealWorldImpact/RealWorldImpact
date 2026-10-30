// Browser storage and wallet responses are data, never trusted HTML or URLs.
export const validHash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
export function cleanTransactions(rows){
  if(!Array.isArray(rows))return [];
  return rows.filter(row=>row&&validHash(row.hash)&&typeof row.account==='string'&&/^0x[0-9a-fA-F]{40}$/.test(row.account)&&row.chain===4663&&typeof row.label==='string'&&typeof row.status==='string'&&Number.isFinite(Date.parse(row.time)))
    .slice(0,100).map(row=>({hash:row.hash,account:row.account.toLowerCase(),chain:4663,label:row.label.slice(0,160),status:row.status.slice(0,80),time:new Date(row.time).toISOString()}));
}
