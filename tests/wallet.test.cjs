const assert=require('node:assert/strict'),wallet=require('../assets/wallet.js');
const a={id:'a',name:'BTC',category:'crypto',currency:'USDT',quantity:.25,price:60000},b={id:'b',name:'股票',category:'stock',currency:'CNY',quantity:100,price:12};
assert.deepEqual(wallet.totals([a,b]),{USDT:15000,CNY:1200});
assert.equal(wallet.normalize([a,a,{...a,id:'bad',quantity:NaN},{...a,id:'infinite',price:Infinity},{...a,id:'zero',quantity:0},{...a,id:'badcur',currency:'BAD'}]).length,1);
const added={...a,id:'new'},changed={...a,quantity:.5},remote={...b,id:'remote'};
assert.deepEqual(wallet.merge([a,b],[changed,added],[a,b,remote]).map(r=>r.id),['a','remote','new']);assert.equal(wallet.merge([a],[changed],[a])[0].quantity,.5);
assert.equal(wallet.normalize([{...a,name:' <script>alert(1)</script> '}])[0].name,'<script>alert(1)</script>','input stays plain text for DOM textContent');
console.log('Wallet: separate currency totals, invalid values excluded, duplicate IDs rejected, concurrent additions and local edits/deletions preserved PASS');

const linked={...a,symbol:'BTC',assetType:'swap',acquiredAt:'2024-01-01'};
assert.equal(wallet.normalize([linked])[0].symbol,'BTC');
assert.equal(wallet.valuation(linked,{c:66000}).pnl,1500);
assert(Math.abs(wallet.valuation(linked,{c:66000}).percent-10)<1e-10);
assert.equal(wallet.valuation(linked,null).pnl,null,'missing quote must never become a zero loss');
assert.equal(wallet.valuation(linked,{c:0}).value,null);
assert.equal(wallet.history(linked,[{t:Date.parse('2023-12-31'),c:50000},{t:Date.parse('2024-01-02'),c:66000},{t:Date.parse('2024-01-03'),c:67000,confirmed:false}]).length,1);
assert.equal(wallet.history(linked,[{t:Date.parse('2024-01-02'),c:66000}])[0].pnl,1500);
assert.equal(wallet.history(a,[{t:Date.parse('2024-01-02'),c:66000}]).length,0);
assert.equal(wallet.normalize([{...linked,acquiredAt:'2024-02-31'}])[0].acquiredAt,undefined);
console.log('Linked holdings: long valuation, no fabricated missing prices, acquisition date and confirmed daily history PASS');

assert.equal(wallet.history(linked,[{t:Date.parse('2023-12-31T16:00:00Z'),c:66000}])[0].date,'2024-01-01','China-market daily bars are labeled by the market day, not the previous UTC day');
