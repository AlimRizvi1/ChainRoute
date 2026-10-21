const byId = (id) => document.getElementById(id);
const percent = (value) => `${(value * 100).toFixed(2)}%`;
let evaluatedVersion;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Engine returned HTTP ${response.status}. Check /health and try again.`);
  return response.json();
}

async function loadEvaluation() {
  try {
    const evidence = await fetchJson('evidence.json');
    const m = evidence.evaluation;
    evaluatedVersion = m.modelVersion;
    byId('samples').textContent = m.totalSamples.toLocaleString();
    byId('split').textContent = `${m.trainingSamples.toLocaleString()} / ${m.testSamples.toLocaleString()}`;
    byId('seed').textContent = m.seed;
    byId('accuracy').textContent = percent(m.accuracy);
    byId('baseline').textContent = percent(m.alwaysOnTimeAccuracy);
    byId('mae').textContent = `${m.probabilityMae.toFixed(5)} (${(m.probabilityMae * 100).toFixed(3)} percentage points)`;
    byId('brier').textContent = m.brierScore.toFixed(5);
    byId('late-recall').textContent = percent(m.lateRecall);
    const difference = (m.accuracy - m.alwaysOnTimeAccuracy) * 100;
    byId('comparison').textContent = `Accuracy is ${difference.toFixed(2)} percentage points above the always-on-time baseline. The test set is imbalanced; report the baseline and late-delivery recall alongside accuracy. MAE ${m.probabilityMae.toFixed(5)} is within the project's ${m.maeTolerance.toFixed(2)} tolerance, but only against this simulator.`;
    const c = m.confusionMatrix;
    for (const [id, value] of Object.entries({ tp: c.trueOnTime, tn: c.trueLate, fp: c.falseOnTime, fn: c.falseLate })) byId(id).textContent = value.toLocaleString();
    byId('evaluated').textContent = new Date(evidence.evaluatedAt).toLocaleString();
    byId('model-version').textContent = m.modelVersion;
    byId('equation').textContent = `slack ratio = (deadline − synthetic departure − transit time) / transit time\nz = ${m.coefficients.intercept.toFixed(6)} + ${m.coefficients.slackRatio.toFixed(6)} × slack ratio ${m.coefficients.cargoVariability.toFixed(6)} × cargo variability\np(on time) = 1 / (1 + exp(−z))\n\nGrain: 0.10 · Coal: 0.20 · Steel: 0.30\nModel: ${m.modelVersion}\nDataset: ${m.trainingDataHash}`;
    byId('evaluation-status').textContent = 'Evaluation loaded. This is a saved, reproducible report; use the form above for a fresh API run.';
    byId('evaluation-body').hidden = false;
  } catch (error) {
    byId('evaluation-status').textContent = `Evaluation could not load. ${error.message} Reload the page after the engine is healthy.`;
  }
}

byId('prediction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = byId('run');
  if (button.disabled) return;
  const cargo = byId('cargo').value;
  const slack = Number(byId('slack').value);
  const deadline = new Date(Date.parse('2026-01-07T20:00:00Z') + 14400000 * (1 + slack)).toISOString();
  const payload = {
    orders: [{ orderId: 'ML-DEMO', cargoType: cargo, quantityTonnes: 10, destination: 'Port-A', priority: 1, deadline }],
    wagons: [{ wagonId: 'DEMO-WAGON', capacityTonnes: 20, wagonType: { grain: 'covered', coal: 'open', steel: 'flat' }[cargo], location: 'Yard-0', available: true }],
    routes: [{ routeId: 'DEMO-ROUTE', origin: 'Yard-0', destination: 'Port-A', distanceKm: 100, transitTimeSeconds: 14400 }],
    weights: { onTime: 1, cost: 0, utilization: 0 }, timeBudgetSeconds: 0.05,
  };
  byId('request').textContent = JSON.stringify(payload, null, 2);
  byId('response').textContent = 'Waiting for the engine…';
  byId('probability').textContent = 'Running…';
  byId('scenario').textContent = 'Sending the selected synthetic scenario to the allocation engine.';
  byId('trace').hidden = true;
  byId('live-facts').hidden = true;
  button.disabled = true;
  button.textContent = 'Running prediction…';
  byId('live-result').setAttribute('aria-busy', 'true');
  byId('live-status').textContent = 'The engine is allocating the wagon and applying the saved model.';
  try {
    const plan = await fetchJson('/v1/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    byId('response').textContent = JSON.stringify(plan, null, 2);
    if (!plan.assignments?.length) throw new Error(`No assignment was returned. ${plan.unassignedOrders?.[0]?.message || 'Inspect the response for details.'}`);
    const prediction = plan.runMetadata.prediction;
    byId('probability').textContent = percent(plan.assignments[0].onTimeProbability);
    byId('scenario').textContent = `${cargo[0].toUpperCase() + cargo.slice(1)}, ${slack * 4} hour(s) spare before deadline ${deadline.replace('.000Z', ' UTC')}.`;
    const facts = byId('live-facts');
    facts.replaceChildren();
    for (const [label, value] of [['Method', prediction.method], ['Model version', prediction.modelVersion || 'No trained model used'], ['Run duration', `${plan.runMetadata.durationMs} ms`], ['Run ID', plan.runId]]) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      facts.append(term, description);
    }
    facts.hidden = false;
    byId('trace').href = `/v1/runs/${encodeURIComponent(plan.runId)}`;
    byId('trace').hidden = false;
    byId('live-status').textContent = prediction.method !== 'logistic_regression'
      ? 'The engine used a fallback. This result is not a trained-model prediction; inspect its metadata.'
      : !evaluatedVersion ? 'Live run complete. Evaluation evidence is unavailable; model version could not be compared.'
      : prediction.modelVersion !== evaluatedVersion ? 'Live run complete, but the model differs from the evaluation. Regenerate the report before presenting its metrics.'
      : 'Live run complete. The model version matches the evaluation below.';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && byId('probability').animate) {
      byId('probability').animate([{ transform: 'translateY(6px)', opacity: 0.65 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  } catch (error) {
    byId('probability').textContent = 'Run unavailable';
    byId('scenario').textContent = 'No prediction is shown for this request.';
    byId('live-status').textContent = `${error.message} Try Run live prediction again when the engine is healthy.`;
    if (byId('response').textContent === 'Waiting for the engine…') byId('response').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Run live prediction';
    byId('live-result').setAttribute('aria-busy', 'false');
  }
});

loadEvaluation();
