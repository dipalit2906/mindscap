import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Dimensions, InteractionManager } from 'react-native';
import { Canvas, Circle, Group, BlurMask, RoundedRect, vec } from '@shopify/react-native-skia';
import {
  useSharedValue,
  withTiming,
  useDerivedValue,
  SharedValue,
  withSequence,
  withDelay,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { MindscapeState } from '../hooks/useMindscapeSession';
import { AudioContext, BiquadFilterNode, GainNode, AudioBufferSourceNode } from 'react-native-audio-api';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const AUDIO_ASSETS = {
  narrowed: require('../../assets/audio/narrowed_texture.mp3'),
  transition: require('../../assets/audio/transition_texture.mp3'),
  expanded: require('../../assets/audio/expanded_base.mp3'),
  stabilised: require('../../assets/audio/stabilised_base.mp3'),
  ney: require('../../assets/audio/ney_layer.mp3'),
};

const { width, height } = Dimensions.get('window');
const CX = width / 2;
const CY = height / 2;

const COLORS: Record<MindscapeState, string> = {
  [MindscapeState.NARROWED]: '#FF7096', // Pink
  [MindscapeState.TRANSITION]: '#FFB347', // Orange
  [MindscapeState.EXPANDED]: '#00FF99', // Green
  [MindscapeState.STABILISED]: '#00CED1', // Teal
};

interface RendererProps {
  state: MindscapeState;
  rmsValue: SharedValue<number>;
  phase: string;
  phaseRampMs: number;
  liveDepth: SharedValue<number>;
  isAwarenessMoment: boolean;
  onAudioReady?: (ready: boolean) => void;
  isMuted?: boolean;
}

export const MindscapeRenderer: React.FC<RendererProps> = ({
  state,
  rmsValue,
  phase,
  phaseRampMs,
  liveDepth,
  isAwarenessMoment,
  onAudioReady,
  isMuted
}) => {
  const [visualState, setVisualState] = useState(state);
  const [isAudioEngineReady, setIsAudioEngineReady] = useState(false);
  const [tracksLoadedCount, setTracksLoadedCount] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Audio Graph Nodes
  const masterGainRef = useRef<GainNode | null>(null);
  const fieldGainsRef = useRef<Record<string, GainNode>>({});
  const neyGainRef = useRef<GainNode | null>(null);

  // Animation values
  const rotation = useSharedValue(0);
  const phaseScale = useSharedValue(1);
  const awarenessPulse = useSharedValue(1);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 15000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisualState(state);
    }, 300);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const dur = Math.max(250, phaseRampMs || 1200);
    if (phase === 'Inhale') {
      phaseScale.value = withTiming(1.6, { duration: dur });
    } else if (phase === 'Exhale') {
      // Exhale should "shrink" smaller than neutral.
      phaseScale.value = withTiming(0.75, { duration: dur });
    } else {
      // Silence: return toward neutral.
      phaseScale.value = withTiming(1.0, { duration: Math.max(250, dur * 0.6) });
    }
  }, [phase, phaseRampMs]);

  useEffect(() => {
    if (isAwarenessMoment) {
      awarenessPulse.value = withSequence(
        withTiming(1.4, { duration: 1000 }),
        withTiming(1, { duration: 1000 })
      );
    }
  }, [isAwarenessMoment]);

  // Derived values for shapes
  // Radius responds to state (phaseScale) and live volume (liveDepth) for "physicality"
  const baseR = useDerivedValue(() => {
    const pulse = 90 * phaseScale.value * awarenessPulse.value;
    const jitter = rmsValue.value * 20; // Reduced jitter as we have liveDepth now

    // LIVE REACTIVITY: Direct breath-to-ring mapping (Requirement: "Live changes")
    // This makes the ring expand exactly as the user breathes.
    const liveBoost = liveDepth.value * 120;

    return pulse + jitter + liveBoost;
  });

  // Generous spacing that expands naturally, matching the design requirement
  const spacing = 18;
  const ring1 = useDerivedValue(() => baseR.value + (spacing * 1));
  const ring2 = useDerivedValue(() => baseR.value + (spacing * 2));
  const ring3 = useDerivedValue(() => baseR.value + (spacing * 3));
  const ring4 = useDerivedValue(() => baseR.value + (spacing * 4));
  const ring5 = useDerivedValue(() => baseR.value + (spacing * 5));
  const ring6 = useDerivedValue(() => baseR.value + (spacing * 6));

  // --- AUDIO ENGINE ---
  useEffect(() => {
    console.log("[AUDIO] Renderer Mounted - Starting Audio Graph Setup");
    let ctx: AudioContext | null = null;
    let isCancelled = false;

    const setup = async () => {
      try {
        ctx = new AudioContext();
        await ctx.resume();
        audioContextRef.current = ctx;

        // 1. Master Gain (Breath Sync)
        const masterGain = ctx.createGain();
        masterGain.gain.value = isMuted ? 0 : 0.4;
        masterGain.connect(ctx.destination);
        masterGainRef.current = masterGain;

        // Helper to load and decode audio reliably in Production APKs
        const loadBuffer = async (assetModule: any, name: string) => {
          console.log(`[AUDIO] Loading: ${name}...`);
          const assets = await Asset.loadAsync(assetModule);
          const localUri = assets[0].localUri || assets[0].uri;
          if (!localUri) throw new Error(`Failed to load asset: ${name}`);

          console.log(`[AUDIO] Reading: ${name}...`);
          // NATIVE LOADER: fetch() on file:// URIs is significantly faster than Base64 reading
          // as it offloads the conversion to native C++ code.
          const response = await fetch(localUri);
          const arrayBuffer = await response.arrayBuffer();

          console.log(`[AUDIO] Decoding: ${name}...`);
          const audioBuffer = await ctx!.decodeAudioData(arrayBuffer);
          console.log(`[AUDIO] Ready: ${name}`);
          return audioBuffer;
        };

        // Define field setup helper once
        const setupField = (buffer: AudioBuffer, filterType?: 'highpass' | 'lowpass', filterFreq?: number) => {
          const gain = ctx!.createGain();
          gain.gain.value = 0.001; // Start silent

          const source = ctx!.createBufferSource();
          source.buffer = buffer;
          source.loop = true;

          if (filterType && filterFreq) {
            const filter = ctx!.createBiquadFilter();
            filter.type = filterType;
            filter.frequency.value = filterFreq;
            source.connect(filter);
            filter.connect(gain);
          } else {
            source.connect(gain);
          }

          source.start(0);
          return gain;
        };

        const fieldGains: Record<string, GainNode> = {};
        const assetEntries = [
          AUDIO_ASSETS.transition,
          AUDIO_ASSETS.narrowed,
          AUDIO_ASSETS.expanded,
          AUDIO_ASSETS.stabilised,
          AUDIO_ASSETS.ney
        ];

        const names = ['Transition', 'Narrowed', 'Expanded', 'Stabilised', 'Ney'];
        const stateKeys = [
          MindscapeState.TRANSITION,
          MindscapeState.NARROWED,
          MindscapeState.EXPANDED,
          MindscapeState.STABILISED,
          'NEY'
        ];

        for (let i = 0; i < assetEntries.length; i++) {
          const buf = await loadBuffer(assetEntries[i], names[i]);

          if (isCancelled) return;

          // Create and connect this specific field immediately
          if (stateKeys[i] === 'NEY') {
            const gain = setupField(buf);
            gain.connect(masterGain);
            neyGainRef.current = gain;
          } else {
            const gain = setupField(buf,
              stateKeys[i] === MindscapeState.NARROWED ? 'highpass' :
                stateKeys[i] === MindscapeState.STABILISED ? 'lowpass' : undefined,
              stateKeys[i] === MindscapeState.NARROWED ? 1000 :
                stateKeys[i] === MindscapeState.STABILISED ? 500 : undefined
            );
            gain.connect(masterGain);
            fieldGains[stateKeys[i]] = gain;
          }

          // If the first track (Transition) is ready, dismiss the loading screen immediately
          if (i === 0) {
            setIsAudioEngineReady(true);
            onAudioReady?.(true);
          }

          // Expose loaded tracks to the engine
          fieldGainsRef.current = { ...fieldGains };
          setTracksLoadedCount(i + 1);

          // SIGNIFICANT UI YIELD: 
          // Pause longer to let animations run while decoding large files.
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      } catch (err) {
        console.error('[AUDIO] Setup failed', err);
        // Fallback: Enable UI even if audio fails
        setIsAudioEngineReady(true);
        onAudioReady?.(true);
      }
    };

    // Defer the heavy setup until after the session entrance animations are clear
    const interactionPromise = InteractionManager.runAfterInteractions(() => {
      setup();
    });

    return () => {
      isCancelled = true;
      interactionPromise.cancel();
      ctx?.close();
    };
  }, []);

  // Axis 1: Breath Sync
  useEffect(() => {
    if (!isAudioEngineReady || !masterGainRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;
    const gain = masterGainRef.current.gain;

    if (isMuted) {
      gain.cancelScheduledValues(now);
      gain.linearRampToValueAtTime(0, now + 0.1);
      return;
    }

    const t = Math.max(0.15, (phaseRampMs || 1200) / 1000);

    // Linear ramp to mimic lung physicality, scaled to breath speed.
    if (phase === 'Inhale') {
      gain.linearRampToValueAtTime(1.0, now + t);
    } else {
      gain.linearRampToValueAtTime(0.2, now + t);
    }
  }, [phase, phaseRampMs, isMuted, isAudioEngineReady, tracksLoadedCount]);

  // Axis 2 & 3: State Morph & Ney Presence
  useEffect(() => {
    if (!isAudioEngineReady || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;

    // Crossfade Fields (1.2s exponential)
    Object.entries(fieldGainsRef.current).forEach(([fieldState, gainNode]) => {
      const target = fieldState === state ? 1.0 : 0.001;
      gainNode.gain.exponentialRampToValueAtTime(target, now + 1.2);
    });

    // Ney Presence Mapping
    if (neyGainRef.current) {
      let neyTarget = 0.001;
      if (state === MindscapeState.TRANSITION) neyTarget = 0.25;
      else if (state === MindscapeState.EXPANDED) neyTarget = 0.65;
      else if (state === MindscapeState.STABILISED) neyTarget = 1.0;

      // Ney emerges slower (2.5s)
      neyGainRef.current.gain.exponentialRampToValueAtTime(neyTarget, now + 2.5);
    }
  }, [state, isAudioEngineReady, tracksLoadedCount]);

  if (isMuted) return null;

  return (
    <View style={styles.container}>
      <Canvas style={styles.canvas}>
        {/* Glow effect behind the main ring */}
        <Group>
          <BlurMask blur={30} style="normal" />
          <Circle cx={CX} cy={CY} r={baseR} style="stroke" strokeWidth={20} color={COLORS[visualState]} opacity={0.3} />
        </Group>

        {/* Main Thick Ring */}
        <Circle cx={CX} cy={CY} r={baseR} style="stroke" strokeWidth={8} color={COLORS[visualState]} opacity={0.9}>
          <BlurMask blur={2} style="solid" />
        </Circle>

        {/* 6 Thin Concentric Rings */}
        <Circle cx={CX} cy={CY} r={ring1} style="stroke" strokeWidth={2} color={COLORS[visualState]} opacity={0.6} />
        <Circle cx={CX} cy={CY} r={ring2} style="stroke" strokeWidth={1.5} color={COLORS[visualState]} opacity={0.4} />
        <Circle cx={CX} cy={CY} r={ring3} style="stroke" strokeWidth={1} color={COLORS[visualState]} opacity={0.25} />
        <Circle cx={CX} cy={CY} r={ring4} style="stroke" strokeWidth={1} color={COLORS[visualState]} opacity={0.15} />
        <Circle cx={CX} cy={CY} r={ring5} style="stroke" strokeWidth={0.5} color={COLORS[visualState]} opacity={0.08} />
        <Circle cx={CX} cy={CY} r={ring6} style="stroke" strokeWidth={0.5} color={COLORS[visualState]} opacity={0.04} />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050505'
  },
  canvas: { flex: 1 },
});
