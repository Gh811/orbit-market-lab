const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');const c={};vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('function briefAssetSummary('),source.indexOf('function renderInfo(){')),c);
const short='东山精密提供电子电路、光模块及精密组件，产品应用于消费电子、通信和汽车。';assert.equal(c.briefAssetSummary(short),short);
const long='公司研发并制造半导体芯片，服务于汽车、通信、消费电子和数据中心客户。'.repeat(8);const result=c.briefAssetSummary(long);assert.ok(result.length<=80);assert.ok(result.endsWith('。'));
assert.ok(c.briefAssetSummary('Long unbroken description '.repeat(20)).length<=80);assert.ok(c.briefAssetSummary('企业'.repeat(100)).length<=80);
assert.equal(c.briefAssetSummary(''),'简介暂未收录。');console.log('Brief asset summary: short business retained, long descriptions fit bounded copy, sentence boundary retained PASS');
