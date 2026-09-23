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
 assert.equal(Model.weeklyDcaActionGate({...signal,signal_score:70,multiplier:1,suggested_action:'BUY'}).extraBlocked,false);
});
