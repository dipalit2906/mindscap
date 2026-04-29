import { useState, useCallback, useRef, useEffect } from 'react';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';
import { useSharedValue, withTiming } from 'react-native-reanimated';

export enum MindscapeState {
  NARROWED = 'Narrowed',
  TRANSITION = 'Transition',
  EXPANDED = 'Expanded',
  STABILISED = 'Stabilised',
}

export type BreathPhase = 'Inhale' | 'Exhale' | 'Silence';

export interface MindscapeMetrics {
  bpm: number;
  variance: number;
  ieRatio: number;
  depth: number;
}

const BPM_WINDOW_MS = 30000;
const VAR_WINDOW_MS = 60000;

export const useMindscapeSession = (isCalibration: boolean = false) => {
  const [state, setState] = useState<MindscapeState>(MindscapeState.TRANSITION);
  const [metrics, setMetrics] = useState<MindscapeMetrics>({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
  const [currentPhase, setCurrentPhase] = useState<BreathPhase>('Silence');
  // Used to make visual/audio ramps match the user's inhale/exhale *speed*.
  const [phaseRampMs, setPhaseRampMs] = useState<number>(1200);
  const liveDepth = useSharedValue(0);
  const phaseRef = useRef<BreathPhase>('Silence');

  // Sync ref with state for use in callbacks
  useEffect(() => { phaseRef.current = currentPhase; }, [currentPhase]);

  // TFLite Model Loading
  const [model, setModel] = useState<TensorflowModel | null>(null);

  useEffect(() => {
    async function loadModel() {
      try {
        const asset = Asset.fromModule(require('../../assets/breath_model1.tflite'));
        await asset.downloadAsync();
        if (asset.localUri) {
          const m = await loadTensorflowModel({ url: asset.localUri }, []);
          setModel(m);
          console.log('[TFLITE] Model loaded from:', asset.localUri);
          console.log('[TFLITE] Model Inputs:', JSON.stringify(m.inputs));
          console.log('[TFLITE] Model Outputs:', JSON.stringify(m.outputs));
        }
      } catch (err) {
        console.error('[TFLITE] Failed to load model:', err);
      }
    }
    loadModel();
  }, []);

  // Metrics tracking
  const cycleTimestamps = useRef<number[]>([]);
  const cycleDurations = useRef<number[]>([]);
  const lastPhaseStartTime = useRef<number>(Date.now());
  const lastInhaleDuration = useRef<number>(0);
  const lastInhaleDurationMsRef = useRef<number>(1200);
  const lastExhaleDurationMsRef = useRef<number>(900);
  const accumulatedInhaleTime = useRef<number>(0);
  const adaptiveFloor = useRef<number>(0.005);
  const coreNoiseFloor = useRef<number>(0.20);
  const detailNoiseFloor = useRef<number>(0.30);
  const floorBuffer = useRef<number[]>([]);
  const peakRms = useRef<number>(0);
  const smoothedRms = useRef<number>(0);
  const dropCounter = useRef<number>(0);

  // State Stability (Hold Durations)
  const stateStartTime = useRef<number>(Date.now());
  const targetState = useRef<MindscapeState>(MindscapeState.TRANSITION);
  // Throttled logging while the breath phase is stuck in Silence.
  const lastSilenceTickTime = useRef<number>(0);

  // Awareness Moment
  const sessionStartTime = useRef<number>(Date.now());
  const hasTriggeredAwareness = useRef<boolean>(false);
  const [isAwarenessMoment, setIsAwarenessMoment] = useState(false);
  const isReadyLogSent = useRef(false);

  // AI inference state
  const isInferenceRunning = useRef(false);
  const lastInferenceTime = useRef<number>(0);
  const confidenceRef = useRef<number>(0);
  const topIndexRef = useRef<number>(-1);
  const dynamicAiThresholdRef = useRef<number>(0.25);
  const detailThresholdRef = useRef<number>(0.40);
  const aiBuffer = useRef<number>(0);

  const calculateMetrics = useCallback(() => {
    if (cycleDurations.current.length === 0) return { bpm: 0, variance: 0 };

    // Smooth BPM (average of last 3 cycles for stability)
    const recentCycles = cycleDurations.current.slice(-3);
    const avgCycle = recentCycles.reduce((a, b) => a + b, 0) / recentCycles.length;
    const bpm = 60000 / avgCycle;

    // Variance (Std Dev) over last 6 cycles (longer window for stability)
    let variance = 0;
    const varCycles = cycleDurations.current.slice(-6);
    if (varCycles.length > 1) {
      const mean = varCycles.reduce((a, b) => a + b, 0) / varCycles.length;
      const squareDiffs = varCycles.map(v => Math.pow(v - mean, 2));
      const rawVariance = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / varCycles.length) / 1000;
      // Smooth the variance itself to prevent spikes
      variance = (variance * 0.5) + (rawVariance * 0.5);
    }

    return { bpm, variance };
  }, []);
  const updateState = useCallback((bpm: number, variance: number, ieRatio: number) => {
    let next: MindscapeState = MindscapeState.TRANSITION; // Default to Transition if criteria not met

    // RELAXED CRITERIA FOR PEAK STATES
    if (bpm < 6) {
      // STABILISED: High performance calm (Relaxed variance requirement)
      next = (variance < 1.5) ? MindscapeState.STABILISED : MindscapeState.EXPANDED;
    } else if (bpm < 10) {
      // EXPANDED: Good calm breathing
      next = MindscapeState.EXPANDED;
    } else if (bpm <= 15) {
      // TRANSITION: Normal/Entering calm
      next = MindscapeState.TRANSITION;
    } else {
      // NARROWED: Fast/Stressed breathing
      next = MindscapeState.NARROWED;
    }

    if (next !== targetState.current) {
      console.log(`[ENGINE] Target State -> ${next} (Holding for stability...)`);
      targetState.current = next;
      stateStartTime.current = Date.now();
    }
  }, [state]);

  // STALE DATA CLEANUP (BPM Decay)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastPhaseStartTime.current > 40000 && metrics.bpm > 0) {
        console.log('[ENGINE] ! STALE DATA: No breath for 40s. Resetting metrics.');
        setMetrics({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
        targetState.current = MindscapeState.TRANSITION;
        stateStartTime.current = now;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [metrics.bpm]);

  const manualTrigger = useCallback((phase: BreathPhase) => {
    handleInference(0.1, 0, 0, undefined, phase);
  }, []);

  const handleInference = useCallback(async (rms: number, zcr: number, centroid: number, waveform?: Float32Array, manualPhase?: BreathPhase) => {
    // 0. NATURAL SIGNAL TRACKING
    smoothedRms.current = (smoothedRms.current * 0.8) + (rms * 0.2);
    const sRms = smoothedRms.current;

    // MIC CHECK removed for production cleanliness
    // Debug snapshot for understanding why inhale/exhale triggers.
    // Logged only when phase changes (so it doesn't spam).
    let debugInfo:
      | {
        sRms: number;
        zcr: number;
        topIdx: number;
        score: number;
        adaptiveFloor: number;
        dynAiThreshold: number;
        isBreathCore: boolean;
        isBreathDetail: boolean;
        isAiConfidentCore: boolean;
        isAiConfidentDetail: boolean;
        hasMasterKey: boolean;
        passesHardWall: boolean;
        isHumanBreathStart: boolean;
        isAiSilence: boolean;
      }
      | null = null;

    if (isCalibration) {
      floorBuffer.current.push(sRms);
      if (floorBuffer.current.length > 100) floorBuffer.current.shift();
      const avg = floorBuffer.current.reduce((a, b) => a + b, 0) / Math.max(floorBuffer.current.length, 1);
      adaptiveFloor.current = Math.max(avg * 1.5, 0.00005); // Lowered minimum for ultra-quiet rooms

      // 1. RUN AI DURING CALIBRATION TO FIND THE "NOISE SCORE"
      const now = Date.now();
      if (now - lastInferenceTime.current > 300 && model && waveform) {
        lastInferenceTime.current = now;
        try {
          const result = await model.run([waveform.buffer]);
          const first = result?.[0];
          const outputData = first instanceof ArrayBuffer ? new Float32Array(first) : (ArrayBuffer.isView(first) ? first as Float32Array : null);

          if (outputData) {
            const scores = Array.from(outputData);
            const coreMax = Math.max(...scores.slice(50, 161));
            const detailMax = scores[494] || 0;

            // Surgical Noise Tracking
            coreNoiseFloor.current = (coreNoiseFloor.current * 0.9) + (coreMax * 0.1);
            detailNoiseFloor.current = (detailNoiseFloor.current * 0.9) + (detailMax * 0.1);

            dynamicAiThresholdRef.current = Math.max(coreNoiseFloor.current + 0.08, 0.20);
            detailThresholdRef.current = Math.max(detailNoiseFloor.current + 0.12, 0.40);
          }
        } catch (e) { }
      }

      if (Math.random() > 0.98) {
        console.log(`[CALIBRATION] Noise: ${avg.toFixed(6)} | AI Floor: ${coreNoiseFloor.current.toFixed(2)} | Threshold: ${dynamicAiThresholdRef.current.toFixed(2)}`);
      }
      return;
    }

    if (!isReadyLogSent.current) {
      console.log('------------------------------------');
      console.log('[ENGINE] CALIBRATION COMPLETE. LISTENING...');
      console.log('------------------------------------');
      isReadyLogSent.current = true;
      floorBuffer.current = [];
    }

    const now = Date.now();

    // 2. HYBRID GATE: Only run AI if volume passes threshold
    if (sRms < adaptiveFloor.current * 0.5) return;

    // 2. THE BRAIN: Run TFLite Inference
    if (now - lastInferenceTime.current > 300) {

      if (model && waveform && !isInferenceRunning.current) {
        try {
          lastInferenceTime.current = now;
          isInferenceRunning.current = true;

          const inputMeta = model.inputs[0];
          // On this device, we MUST pass the raw buffer
          const result = await model.run([waveform.buffer]);

          if (!result || !Array.isArray(result) || result.length === 0) return;

          // Unwrap the ArrayBuffer result (proven to work in Deep Scan)
          const first = result[0];
          let outputData: Float32Array | null = null;

          if (first instanceof ArrayBuffer) {
            outputData = new Float32Array(first);
          } else if (ArrayBuffer.isView(first)) {
            outputData = first as Float32Array;
          }

          if (outputData && outputData.length > 0) {
            const scores: { idx: number, score: number }[] = [];
            for (let i = 0; i < outputData.length; i++) {
              scores.push({ idx: i, score: outputData[i] });
            }
            const top3 = scores.sort((a, b) => b.score - a.score).slice(0, 3);
            if (top3.length > 0) {
              console.log(`[AI] Top: ${JSON.stringify(top3.map(s => `${s.idx}:${(s.score * 100).toFixed(0)}%`))}`);
              confidenceRef.current = top3[0].score;
              topIndexRef.current = top3[0].idx;
            }
          }
        } catch (err) {
          console.error('[TFLITE] Inference failed:', err);
        } finally {
          isInferenceRunning.current = false;
        }
      }
    }

    // 1. NOISE REJECTION FILTERS (AI + DSP)
    const topIdx = topIndexRef.current;
    const score = confidenceRef.current;

    let nextPhase: BreathPhase = phaseRef.current;

    if (manualPhase) {
      nextPhase = manualPhase;
    } else {
      // Reliability Gating:
      // Cluster A: Strict Human Breath (67=Snore, 68=Breathe, 69=Wheeze, 70=Sniff, 103=Sigh)
      // Cluster B (494): Breath Detail Cluster.
      const isBreathCore = (topIdx >= 67 && topIdx <= 70) || topIdx === 103;
      const isBreathDetail = (topIdx === 494);

      // SNR GATE: Only trust the AI "Breath" score if the microphone signal is clearly 
      // above the noise floor. This prevents "ghost" breaths in quiet rooms.
      const isSignalAboveNoise = sRms > adaptiveFloor.current * 1.5; // Relaxed from 1.8

      const isAiConfidentCore = isSignalAboveNoise && isBreathCore && score > dynamicAiThresholdRef.current;
      const isAiConfidentDetail = isSignalAboveNoise && isBreathDetail && score > 0.40;

      // MASTER KEY: If AI is sure (>0.85), we trust it but still need volume
      const hasMasterKey = (isBreathCore || isBreathDetail) && score > 0.85 && sRms > 0.001;

      // HARD SILENCE WALL:
      // Use a relative threshold tied to the adaptive noise floor.
      // Your tick logs show `sRms` during real quiet breathing is often around ~1e-4,
      // so a fixed `0.0008` blocks inhale/exhale entirely.
      const passesHardWall = sRms > Math.max(adaptiveFloor.current * 0.7, 0.00001);

      // 2. DIFFERENTIAL DETECTION (Ultra-sensitive trend)
      const lastRms = floorBuffer.current.length > 0 ? floorBuffer.current[floorBuffer.current.length - 1] : sRms;
      const isRising = sRms > adaptiveFloor.current && sRms > lastRms * 1.02;
      floorBuffer.current.push(sRms);
      if (floorBuffer.current.length > 10) floorBuffer.current.shift();

      const isStrongVolumeSpike = sRms > adaptiveFloor.current * 2.0 && isRising;

      // Start of a real breath should be:
      // - loud enough relative to adaptiveFloor
      // - not too "noisy" (ZCR sanity)
      // - a *rise* (differential detection)
      // - optionally confirmed by AI detail/core clusters
      //
      // This prevents "AI says breath" from triggering inhale when RMS is not rising.
      // HYBRID TRIGGER: Trust the breath if AI says so OR if Volume is significantly high (SNR > 8)
      const isStrongSignal = sRms > adaptiveFloor.current * 8.0;

      const isHumanBreathStart =
        passesHardWall &&
        zcr < 0.90 && // Slightly stricter ZCR to ensure volume override isn't friction
        isRising &&
        (hasMasterKey || isAiConfidentCore || isAiConfidentDetail || isStrongSignal);

      const isHumanBreathSustain = zcr < 0.95 && (isAiConfidentCore || isAiConfidentDetail);
      const isAiSilence = topIdx === 0 && score > 0.70;
      debugInfo = {
        sRms,
        zcr,
        topIdx,
        score,
        adaptiveFloor: adaptiveFloor.current,
        dynAiThreshold: dynamicAiThresholdRef.current,
        isBreathCore,
        isBreathDetail,
        isAiConfidentCore,
        isAiConfidentDetail,
        hasMasterKey,
        passesHardWall,
        isHumanBreathStart,
        isAiSilence,
      };

      // 3. CORE STATE MACHINE (Silence -> Inhale -> Exhale)
      const activePhase = phaseRef.current;
      nextPhase = activePhase;

      // 1Hz visibility into why we may be stuck in Silence.
      // This helps distinguish "too quiet to pass gate" vs "AI says breath but gating blocks it".
      if (activePhase === 'Silence') {
        const silenceDuration = now - lastPhaseStartTime.current;
        if (now - lastSilenceTickTime.current > 1000) {
          lastSilenceTickTime.current = now;
          console.log(
            `[ENGINE] TICK Silence dur=${silenceDuration}ms ` +
            `sRms=${sRms.toFixed(5)} floor=${adaptiveFloor.current.toFixed(5)} ` +
            `passRms=${(sRms > adaptiveFloor.current * 1.05) ? 'true' : 'false'} ` +
            `passesHardWall=${passesHardWall} zcr=${zcr.toFixed(3)} ` +
            `top=${topIdx} score=${score.toFixed(3)} ` +
            `dynTh=${dynamicAiThresholdRef.current.toFixed(3)} aiDetail=${isBreathDetail} aiConfDetail=${isAiConfidentDetail} `
            + `isRising=${isRising} humanStart=${isHumanBreathStart}`
          );
        }
      }

      if (activePhase === 'Silence') {
        // Require a stronger rise + a short consistency window before starting inhale.
        if (sRms > adaptiveFloor.current * 1.2 && isHumanBreathStart) {
          dropCounter.current++;
          if (dropCounter.current >= 3) { // Reduced from 6 to 3 for ~300ms responsiveness
            nextPhase = 'Inhale';
            dropCounter.current = 0;
            peakRms.current = sRms;
            console.log('[ENGINE] >>> INHALE (Confirmed)');
          }
        } else {
          dropCounter.current = 0;
        }
      } else if (activePhase === 'Inhale') {
        if (sRms > peakRms.current) peakRms.current = sRms;

        const inhaleDuration = Date.now() - lastPhaseStartTime.current;

        // EXHALE TRIGGER: Volume drop OR AI detected silence
        // Require a *meaningful inhale* first, otherwise we get 500ms "fake cycles".
        const MIN_INHALE_MS = 800; // Reduced from 1200 for responsiveness
        const MIN_PEAK_RATIO = 1.6; // peakRms must be above adaptive floor
        const peakOk = peakRms.current > adaptiveFloor.current * MIN_PEAK_RATIO;

        // IMMEDIATE EXIT: If signal drops below the noise floor, exit Inhale regardless of timer
        const isDeadAir = sRms < adaptiveFloor.current * 1.1;

        if (
          (inhaleDuration > MIN_INHALE_MS && peakOk && (sRms < peakRms.current * 0.60 || isAiSilence)) ||
          (inhaleDuration > 500 && isDeadAir)
        ) {
          dropCounter.current++;
          if (dropCounter.current >= 2) {
            nextPhase = 'Exhale';
            console.log('[ENGINE] <<< EXHALE');
            dropCounter.current = 0;
          }
        } else {
          dropCounter.current = 0;
        }
      } else if (activePhase === 'Exhale') {
        const exhaleDuration = Date.now() - lastPhaseStartTime.current;
        const isExhaleComplete = exhaleDuration > lastInhaleDuration.current * 0.8;

        const MIN_EXHALE_MS = 800;
        if (
          exhaleDuration > MIN_EXHALE_MS &&
          (sRms < adaptiveFloor.current * 1.2 || sRms < peakRms.current * 0.6 || isAiSilence) &&
          isExhaleComplete
        ) {
          nextPhase = 'Silence';
          console.log('[ENGINE] --- PAUSE');
        } else if (isRising && sRms > adaptiveFloor.current * 1.5 && exhaleDuration > 1200 && isHumanBreathStart) {
          nextPhase = 'Inhale';
          console.log('[ENGINE] >>> RE-INHALE');
        }
      }

      // 3. SMART SEARCH: If in long silence, aggressively lower floor to find the user
      const silenceDuration = Date.now() - lastPhaseStartTime.current;
      if (activePhase === 'Silence' && silenceDuration > 6000 && Math.random() > 0.9) {
        adaptiveFloor.current = Math.max(adaptiveFloor.current * 0.9, 0.00005);
      }
    }

    // 4. LIVE DEPTH TRACKING (The "Live" Ring Driver)
    // Map current volume (sRms) to 0.0 - 1.0 range relative to noise floor and peaks
    const floor = adaptiveFloor.current;
    const peak = Math.max(peakRms.current, floor * 1.5, 0.0005); // Significantly lowered minimum peak for sensitivity
    const range = Math.max(peak - floor, 0.0001);
    let targetDepth = 0;

    if (nextPhase === 'Inhale') {
      targetDepth = Math.min(Math.max((sRms - floor) / range, 0), 1.0);
    } else if (nextPhase === 'Exhale') {
      // Exhale depth decays but maintains some live volume response
      targetDepth = Math.min(Math.max((sRms - floor) / range, 0), 1.0) * 0.6;
    } else {
      targetDepth = 0;
    }

    // Smoothly animate the live depth for the UI to pick up
    liveDepth.value = withTiming(targetDepth, { duration: 150 });

    if (nextPhase !== phaseRef.current) {
      const nowTime = Date.now();
      const activePhase = phaseRef.current;
      const duration = nowTime - lastPhaseStartTime.current;

      // SYNC IMMEDIATELY to prevent duplicate logs in fast callbacks
      if (debugInfo) {
        const dbg = debugInfo;
        console.log(
          `[ENGINE] PHASE ${activePhase} -> ${nextPhase} ` +
          `dur=${duration}ms sRms=${dbg.sRms.toFixed(5)} zcr=${dbg.zcr.toFixed(3)} ` +
          `top=${dbg.topIdx} score=${dbg.score.toFixed(3)} ` +
          `floor=${dbg.adaptiveFloor.toFixed(5)} dynTh=${dbg.dynAiThreshold.toFixed(3)} ` +
          `aiCore=${dbg.isAiConfidentCore} aiDetail=${dbg.isAiConfidentDetail} ` +
          `humanStart=${dbg.isHumanBreathStart}`
        );
      } else {
        console.log(`[ENGINE] PHASE ${activePhase} -> ${nextPhase} dur=${duration}ms`);
      }
      phaseRef.current = nextPhase;
      setCurrentPhase(nextPhase);
      lastPhaseStartTime.current = nowTime;

      if (activePhase === 'Inhale') {
        accumulatedInhaleTime.current += duration;
        lastInhaleDuration.current = accumulatedInhaleTime.current;
        // For ramp estimation on next inhale/exhale.
        lastInhaleDurationMsRef.current = duration;
      } else if (activePhase === 'Exhale') {
        const activeDuration = lastInhaleDuration.current + duration;
        accumulatedInhaleTime.current = 0; // Reset after successful cycle
        // For ramp estimation on next inhale/exhale.
        lastExhaleDurationMsRef.current = duration;

        if (activeDuration > 1000) {
          const currentCycleStart = now - activeDuration;

          // Accurate BPM: Time since LAST inhale started
          let cycleToUse = cycleTimestamps.current.length > 0
            ? (currentCycleStart - cycleTimestamps.current[cycleTimestamps.current.length - 1])
            : activeDuration * 2.5;

          // SAFETY: Full cycle must be at least as long as the breath itself
          if (cycleToUse < activeDuration) cycleToUse = activeDuration + 500;

          // NOISE FILTER: Ignore unrealistically fast cycles (< 2.8s)
          // Also ignore cycles that were forced by a safety reset (> 11s inhale)
          if (cycleToUse > 2800 && lastInhaleDuration.current < 11000) {
            cycleDurations.current.push(activeDuration);
            cycleTimestamps.current.push(currentCycleStart); // Record the start of this successful breath
            if (cycleTimestamps.current.length > 20) cycleTimestamps.current.shift();

            const { bpm: rawBpm, variance } = calculateMetrics();

            // Final Smoothing Filter: Don't allow the display BPM to jump by more than 30% instantly
            const lastBpm = metrics.bpm || rawBpm;
            const bpm = (lastBpm * 0.4) + (rawBpm * 0.6);
            const ieRatio = lastInhaleDuration.current / duration;
            const depth = Math.min(peakRms.current / 0.1, 1.0);

            setMetrics({ bpm, variance, ieRatio, depth });
            console.log(`[ENGINE] Metrics -> BPM: ${bpm.toFixed(1)}, VAR: ${variance.toFixed(2)}, I/E: ${ieRatio.toFixed(2)}`);
            updateState(bpm, variance, ieRatio);
          }
        }
      } else if (activePhase === 'Silence') {
        // Adapt noise floor conservatively during silence
        const silenceAvg = sRms;
        // Only raise floor if it's consistently quiet to avoid swallowing shallow breaths
        if (silenceAvg > adaptiveFloor.current) {
          adaptiveFloor.current = (adaptiveFloor.current * 0.995) + (silenceAvg * 1.1 * 0.005);
        } else {
          adaptiveFloor.current = (adaptiveFloor.current * 0.9) + (silenceAvg * 1.1 * 0.1);
        }
      }

      // SAFETY: If stuck in Exhale for > 6s (reduced from 12s), force Silence
      if (activePhase === 'Exhale' && duration > 6000) {
        console.log('[ENGINE] ! SAFETY RESET: Phase Exhale too long. Force Silence.');
        nextPhase = 'Silence';
        // Still give credit for the long breath before resetting
        const { bpm, variance } = calculateMetrics();
        const ieRatio = lastInhaleDuration.current / duration;
        setMetrics(prev => ({ ...prev, bpm, variance, ieRatio }));
        console.log(`[ENGINE] Metrics (Safety) -> BPM: ${bpm.toFixed(1)}, VAR: ${variance.toFixed(2)}, I/E: ${ieRatio.toFixed(2)}`);
        updateState(bpm, variance, ieRatio);
      }

      // SAFETY HEARTBEAT: If a breath phase is unrealistically long (> 12s), force a reset
      if (duration > 12000 && (activePhase === 'Inhale')) {
        console.log(`[ENGINE] ! SAFETY RESET: Phase ${activePhase} too long. Force Silence.`);
        nextPhase = 'Silence';
        adaptiveFloor.current *= 0.5; // Aggressively increase sensitivity on stuck inhale
      }

      // Set ramp duration for the *incoming* phase.
      // This makes the ring/audio transitions match the user's breathing speed.
      const clampMs = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
      if (nextPhase === 'Inhale') {
        setPhaseRampMs(clampMs(lastInhaleDurationMsRef.current || 1200, 300, 6000));
      } else if (nextPhase === 'Exhale') {
        setPhaseRampMs(clampMs(lastExhaleDurationMsRef.current || 900, 300, 6000));
      } else {
        setPhaseRampMs(700);
      }

      setCurrentPhase(nextPhase);
      lastPhaseStartTime.current = nowTime;
      if (nextPhase === 'Inhale') peakRms.current = sRms;
    } else if (nextPhase === 'Inhale' || phaseRef.current === 'Inhale') {
      peakRms.current = Math.max(peakRms.current, sRms);
    }
  }, [model, isCalibration, currentPhase, calculateMetrics]);

  // State Stability & Awareness Monitor
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const timeInTarget = now - stateStartTime.current;

      // 10s AUTO-RESET: If no breath detected for 10s, return to initial phase
      const isAlreadyAtStart = state === MindscapeState.TRANSITION && metrics.bpm === 0;
      const silenceDuration = now - lastPhaseStartTime.current;

      // Safety: Only reset if truly in Silence and been there for >10s
      if (!isCalibration && !isAlreadyAtStart && currentPhase === 'Silence' && silenceDuration > 10000) {
        console.log(`[ENGINE] 10s Inactivity (dur=${silenceDuration}ms) -> Auto-Reset`);
        reset();
        return;
      }

      // SETTLING WINDOW: If we just reset, wait 2 seconds before allowing state jumps
      if (now - lastPhaseStartTime.current < 2000) return;

      // HOLD DURATIONS: Reduced for better responsiveness
      const holdRequired: Record<MindscapeState, number> = {
        [MindscapeState.NARROWED]: 2000,      // Faster entry into stress
        [MindscapeState.TRANSITION]: 3000,    // Faster recovery
        [MindscapeState.EXPANDED]: 4000,      // 4s instead of 8s
        [MindscapeState.STABILISED]: 6000,    // 6s instead of 10s
      };

      if (targetState.current !== state && timeInTarget >= holdRequired[targetState.current]) {
        // Transition Bridge Rule: No skipping states (prevents sudden Narrowed jumps)
        const states = [MindscapeState.NARROWED, MindscapeState.TRANSITION, MindscapeState.EXPANDED, MindscapeState.STABILISED];
        const currIdx = states.indexOf(state);
        const targetIdx = states.indexOf(targetState.current);

        if (Math.abs(currIdx - targetIdx) > 2) { // Allow jumping 2 states (e.g. Narrowed -> Expanded)
          const step = targetIdx > currIdx ? 1 : -1;
          const nextStep = states[currIdx + step];
          console.log(`[ENGINE] State Transition Bridge: ${state} -> ${nextStep}`);
          setState(nextStep);
          stateStartTime.current = now; // Reset timer for the next step
        } else {
          console.log(`[ENGINE] State Confirmed: ${targetState.current}`);
          setState(targetState.current);
        }

        // Awareness Moment Check (after 45s)
        if (now - sessionStartTime.current > 45000 && !hasTriggeredAwareness.current) {
          setIsAwarenessMoment(true);
          hasTriggeredAwareness.current = true;
          setTimeout(() => setIsAwarenessMoment(false), 3000);
        }
      }
    }, 200); // Faster polling (200ms)

    return () => clearInterval(timer);
  }, [state]);

  const reset = () => {
    setState(MindscapeState.TRANSITION);
    setMetrics({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
    cycleTimestamps.current = [];
    cycleDurations.current = [];
    targetState.current = MindscapeState.TRANSITION;
    stateStartTime.current = Date.now();
    lastInhaleDurationMsRef.current = 1200;
    lastExhaleDurationMsRef.current = 900;
    setPhaseRampMs(1200);
    liveDepth.value = 0;
    sessionStartTime.current = Date.now();
    lastPhaseStartTime.current = Date.now(); // MUST RESET THIS TOO
    accumulatedInhaleTime.current = 0;
    hasTriggeredAwareness.current = false;
    setIsAwarenessMoment(false);
  };

  return {
    state,
    metrics,
    currentPhase,
    liveDepth,
    phaseRampMs,
    handleInference,
    manualTrigger,
    isAwarenessMoment,
    reset
  };
};
