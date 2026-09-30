const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../weekly-signal-model');
test('raw drawdown threshold is evaluated before display rounding', () => {
 const rows = Array.from({length:60},(_,i)=>({date:String(i),close:100}));
 rows[59].close=64.999;
 const result=Model.calculateEnhancedLowFrequencyMultiplier(rows,-15,-1,-15,{type:'Bull'});
 assert.equal(result.drawdown,35);
 assert.equal(result.drawdown_adjustment,1.1);
});
test('existing price action hard stops survive extraction', () => {
 const signal={data_source:'Historical',data_freshness:'fresh',decision_change:-5,weekly_change:-5,multiplier:.3,signal_score:65,risk_level:'Low',algorithm:{}};
 assert.equal(Model.getActionLabelFromMultiplier(signal).cls,'action-pause-buy');
 assert.equal(Model.getSuggestedAction({...signal,risk_level:'Extreme'}),'DO_NOT_BUY');
 assert.equal(Model.getSuggestedAction({...signal,decision_change:16}),'CONSIDER_SELL');
});

test('weekly base distinguishes ordinary price timing from non-negotiable risk blocks', () => {
 const signal={data_source:'Historical',data_freshness:'fresh',decision_change:-5,weekly_change:-5,multiplier:.3,signal_score:15,risk_level:'Low',algorithm:{},suggested_action:'DO_NOT_BUY'};
 assert.deepEqual(Model.weeklyDcaActionGate(signal), {actionBlocked:false,extraBlocked:true});
 for (const change of [{risk_level:'Extreme'}, {panic_active:true}, {algorithm:{drawdown:35}}, {portfolio_adjustment:0}, {algorithm:{portfolio_adjustment:0}}, {data_freshness:'stale'}, {suggested_action:'HOLD'}, {suggested_action:'CONSIDER_SELL'}]) {
   assert.deepEqual(Model.weeklyDcaActionGate({...signal,...change}), {actionBlocked:true,extraBlocked:true});
 }
 assert.equal(Model.weeklyDcaActionGate({...signal,signal_score:70,multiplier:1,suggested_action:'BUY',algorithm:{drawdown:5,realized_weekly_volatility:2,trend:{status:'normal'},history_rows:60}}).extraBlocked,false);
});

const fullRiskSignal = () => ({data_source:'Historical',data_freshness:'fresh',decision_change:-5,weekly_change:-5,multiplier:1,signal_score:70,risk_level:'Low',suggested_action:'BUY',algorithm:{drawdown:5,realized_weekly_volatility:2,trend:{status:'normal'},history_rows:60}});

test('complete risk history unlocks extras, while missing indicators leave only the allowed base', () => {
 const complete = fullRiskSignal();
 assert.equal(Model.riskDataStatus(complete),'known');
 assert.deepEqual(Model.weeklyDcaActionGate(complete),{actionBlocked:false,extraBlocked:false});
 for (const algorithm of [{}, {...complete.algorithm,drawdown:null}, {...complete.algorithm,drawdown:NaN}, {...complete.algorithm,realized_weekly_volatility:null}, {...complete.algorithm,trend:null}, {...complete.algorithm,trend:{}}, {...complete.algorithm,history_rows:20}]) {
  const unknown = {...complete,algorithm};
  assert.equal(Model.riskDataStatus(unknown),'unknown');
  assert.deepEqual(Model.weeklyDcaActionGate(unknown),{actionBlocked:false,extraBlocked:true});
 }
 assert.equal(Model.riskDataStatus({...complete,algorithm:{...complete.algorithm,history_rows:21}}),'known');
});

test('missing freshness and stale risk field metadata always report risk unknown', () => {
 const signal = fullRiskSignal();
 for (const field of ['trend','volatility','drawdown']) {
  for (const metadata of [{missing:true}, {stale:true}, {freshness:'missing'}, {freshness:'stale'}, {freshness:'invalid'}, {freshness:'future'}]) {
   const unknown = {...signal,algorithm:{...signal.algorithm,field_meta:{[field]:metadata}}};
   assert.equal(Model.riskDataStatus(unknown),'unknown',field+' '+JSON.stringify(metadata));
   assert.deepEqual(Model.weeklyDcaActionGate(unknown),{actionBlocked:false,extraBlocked:true});
  }
 }
 for (const data_freshness of ['missing','stale','invalid','future']) {
  const unknown = {...signal,data_freshness};
  assert.equal(Model.riskDataStatus(unknown),'unknown',data_freshness);
  assert.deepEqual(Model.weeklyDcaActionGate(unknown),{actionBlocked:true,extraBlocked:true});
 }
 assert.equal(Model.riskDataStatus({...signal,algorithm:{...signal.algorithm,field_meta:{trend:{freshness:'fresh'},volatility:{freshness:'fresh'},drawdown:{freshness:'fresh'}}}}),'known');
});

test('unknown risk does not weaken Extreme, 35 percent drawdown, panic, and manual blocking gates', () => {
 const base = {...fullRiskSignal(),algorithm:{}};
 for (const change of [{risk_level:'Extreme'}, {panic_active:true}, {algorithm:{drawdown:35}}, {algorithm:{drawdown:35.01}}, {portfolio_adjustment:0}, {algorithm:{portfolio_adjustment:0}}, {data_validation_status:'invalid'}, {data_source:'Unavailable'}, {decision_change:null}, {suggested_action:'HOLD'}, {suggested_action:'CONSIDER_SELL'}]) {
  const blocked = {...base,...change};
  assert.equal(Model.riskDataStatus(blocked),'unknown');
  assert.deepEqual(Model.weeklyDcaActionGate(blocked),{actionBlocked:true,extraBlocked:true},JSON.stringify(change));
 }
 assert.deepEqual(Model.weeklyDcaActionGate({...base,algorithm:{drawdown:34.99}}),{actionBlocked:false,extraBlocked:true});
});
