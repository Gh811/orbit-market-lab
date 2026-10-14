const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const nodes={};class Node{constructor(){this.children=[];this.dataset={};this.attrs={}}append(...n){this.children.push(...n);for(const x of n)if(x.id)nodes[x.id]=x}setAttribute(k,v){this.attrs[k]=v}querySelectorAll(){return this.children.flatMap(n=>n.children).filter(n=>n.type==='button')}before(n){nodes[n.id]=n}}
nodes.authForm=new Node();nodes.authSubmit=new Node();let previews=0;
const c={authMode:'register',registrationPetKind:0,HOT_GROUP_ID:'ghot',SPACE_PETS:Array.from({length:8},(_,i)=>({name:'Pet '+i})),companionArtworkUrl:i=>'/pet'+i+'.png',document:{createElement:()=>new Node()},window:{innerWidth:428},$:id=>nodes[id],syncAuthMascot(){previews++}};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('function renderAuthPetChoices('),source.indexOf('function setupAccount(')),c);
vm.runInContext(source.slice(source.indexOf('function defaultAccountState('),source.indexOf('function restoreAccount(')),c);
c.renderAuthPetChoices();const picker=nodes.authPetPicker,buttons=picker.querySelectorAll();assert.equal(picker.hidden,false);assert.equal(buttons.length,8);assert.equal(buttons[0].attrs['aria-pressed'],'true');
buttons[6].onclick();assert.equal(c.registrationPetKind,6);assert.equal(buttons[6].attrs['aria-pressed'],'true');assert.equal(buttons[0].attrs['aria-pressed'],'false');assert.equal(previews,1);assert.equal(c.defaultAccountState().groups[0].petKind,0,'default watchlist companion is independent of the personal avatar');assert.match(source,/authMode==='register'\?\{avatarKind:registrationPetKind\}/,'registration still submits the chosen personal avatar');
c.authMode='login';c.renderAuthPetChoices();assert.equal(picker.hidden,true);assert.equal(c.defaultAccountState().groups[0].petKind,0,'login does not inherit another registration choice');
c.window.innerWidth=1440;delete nodes.authPetPicker;c.renderAuthPetChoices();assert.equal(nodes.authPetPicker,undefined,'desktop has no mobile picker');
console.log('Registration avatar: eight choices, rabbit default, preview, selected avatar in new account state, login and desktop isolation PASS');
