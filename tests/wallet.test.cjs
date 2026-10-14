const assert=require('node:assert/strict'),wallet=require('../assets/wallet.js');
const a={id:'a',name:'BTC',category:'crypto',currency:'USDT',quantity:.25,price:60000},b={id:'b',name:'股票',category:'stock',currency:'CNY',quantity:100,price:12};
assert.deepEqual(wallet.totals([a,b]),{USDT:15000,CNY:1200});
assert.equal(wallet.normalize([a,a,{...a,id:'bad',quantity:NaN},{...a,id:'infinite',price:Infinity},{...a,id:'zero',quantity:0},{...a,id:'badcur',currency:'BAD'}]).length,1);
const added={...a,id:'new'},changed={...a,quantity:.5},remote={...b,id:'remote'};
assert.deepEqual(wallet.merge([a,b],[changed,added],[a,b,remote]).map(r=>r.id),['a','remote','new']);assert.equal(wallet.merge([a],[changed],[a])[0].quantity,.5);
assert.equal(wallet.normalize([{...a,name:' <script>alert(1)</script> '}])[0].name,'<script>alert(1)</script>','input stays plain text for DOM textContent');
console.log('Wallet: separate currency totals, invalid values excluded, duplicate IDs rejected, concurrent additions and local edits/deletions preserved PASS');
