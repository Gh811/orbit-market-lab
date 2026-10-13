const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
let pixels=new Uint8ClampedArray(32*32*4),samples=0;
const c={document:{createElement:()=>({getContext:()=>({drawImage(){samples++},getImageData:()=>({data:pixels})})}),querySelectorAll:()=>[]},logoURLFor:a=>'/'+a.symbol+'.png'};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const logoCardPalettes='),source.indexOf('// 卡面示意图')),c);
for(let i=0;i<pixels.length;i+=4){pixels.set(i<pixels.length*.7?[240,110,20,255]:[20,170,210,255],i)}
const palette=c.sampleLogoCardPalette({});assert.ok(palette[0].h>15&&palette[0].h<40);assert.ok(palette[1].h>180&&palette[1].h<210,'second logo color is retained');
c.updateLogoCardPalette('/AAA.png',{});const first=c.deckColor({symbol:'AAA',cardColor:99}),again=c.deckColor({symbol:'AAA',cardColor:1});assert.deepEqual(first,again,'legacy random color cannot override logo palette');assert.ok(first.h<45);assert.ok(first.secondaryH>170);
c.updateLogoCardPalette('/BBB.png',{});assert.notDeepEqual(c.deckColor({symbol:'BBB'}),first,'same logo colors receive stable subtle differences');
const count=samples;c.updateLogoCardPalette('/AAA.png',{});assert.equal(samples,count,'decoded logo is sampled once');
pixels.fill(255);const gray=c.sampleLogoCardPalette({});assert.ok(gray[0].s<20,'white and monochrome artwork stays neutral');
assert.equal(c.deckColor({symbol:'BTC'}).h,c.deckColor({symbol:'BTC'}).h);assert.ok(c.deckColor({symbol:'UNKNOWN'}).s<25,'unknown logo has subdued fallback');
console.log('Logo palette: dominant and secondary extraction, stable blend, similar-logo differences, old random color ignored, one sample per image, neutral fallback PASS');
