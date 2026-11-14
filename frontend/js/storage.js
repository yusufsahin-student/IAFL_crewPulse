// Health records remain on this browser. IndexedDB avoids synchronous form writes.
const dbPromise=new Promise((resolve,reject)=>{
 const r=indexedDB.open('astro-health-local',1);
 r.onupgradeneeded=()=>r.result.createObjectStore('records');
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});
export async function localRecord(key,value){
 const db=await dbPromise;return new Promise((resolve,reject)=>{
  const tx=db.transaction('records',value===undefined?'readonly':'readwrite');
  const store=tx.objectStore('records');const req=value===undefined?store.get(key):value===null?store.delete(key):store.put(value,key);
  tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
}
