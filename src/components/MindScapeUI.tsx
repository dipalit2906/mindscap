import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Circle, Group, Paint, Blur, vec, LinearGradient } from '@shopify/react-native-skia';
import Animated, { 
  useSharedValue, 
  useDerivedValue, 
  withTiming, 
  withRepeat, 
  withSequence,
  Easing,
  interpolateColor
} from 'react-native-reanimated';
import { BreathingState } from '../hooks/useBreathingEngine';

interface MindScapeUIProps {
  state: BreathingState;
  bpm: number;
}

const STATE_CONFIG = {
  [BreathingState.NARROWED]: {
    radius: 60,
    color: '#FF6B6B',
    blur: 10,
    strokeWidth: 8,
  },
  [BreathingState.TRANSITION]: {
    radius: 90,
    color: '#FFD93D',
    blur: 15,
    strokeWidth: 6,
  },
  [BreathingState.EXPANDED]: {
    radius: 130,
    color: '#6BCB77',
    blur: 20,
    strokeWidth: 4,
  },
  [BreathingState.STABILISED]: {
    radius: 160,
    color: '#4D96FF',
    blur: 25,
    strokeWidth: 2,
  },
};

export const MindScapeUI: React.FC<MindScapeUIProps> = ({ state, bpm }) => {
  const { width, height } = useWindowDimensions();
  const centerX = width / 2;
  const centerY = height / 2;

  const targetRadius = useSharedValue(STATE_CONFIG[state].radius);
  const targetBlur = useSharedValue(STATE_CONFIG[state].blur);
  const targetStrokeWidth = useSharedValue(STATE_CONFIG[state].strokeWidth);
  
  // Animation for "pulsing" based on BPM
  const pulse = useSharedValue(1);

  useEffect(() => {
    const config = STATE_CONFIG[state];
    targetRadius.value = withTiming(config.radius, { duration: 1000 });
    targetBlur.value = withTiming(config.blur, { duration: 1000 });
    targetStrokeWidth.value = withTiming(config.strokeWidth, { duration: 1000 });
    
    // Adjust pulse speed based on BPM
    const pulseDuration = bpm > 0 ? (60000 / bpm) / 2 : 2000;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.1, { duration: pulseDuration, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: pulseDuration, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
  }, [state, bpm]);

  const animatedRadius = useDerivedValue(() => {
    return targetRadius.value * pulse.value;
  });

  const animatedColor = useDerivedValue(() => {
    // This is a simplification; ideally we'd interpolate between all states
    return STATE_CONFIG[state].color;
  });

  return (
    <View style={styles.container}>
      <Canvas style={styles.canvas}>
        <Group>
          <Paint style="stroke" strokeWidth={targetStrokeWidth}>
            <Blur blur={targetBlur} />
          </Paint>
          
          {/* Main Breathing Ring */}
          <Circle
            cx={centerX}
            cy={centerY}
            r={animatedRadius}
            color={animatedColor}
            style="stroke"
            strokeWidth={targetStrokeWidth}
          >
            <LinearGradient
              start={vec(centerX - 100, centerY - 100)}
              end={vec(centerX + 100, centerY + 100)}
              colors={[STATE_CONFIG[state].color, '#ffffff55']}
            />
          </Circle>

          {/* Inner Glow */}
          <Circle
            cx={centerX}
            cy={centerY}
            r={useDerivedValue(() => animatedRadius.value * 0.8)}
            color={animatedColor}
            opacity={0.3}
          >
            <Blur blur={20} />
          </Circle>
        </Group>
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  canvas: {
    flex: 1,
  },
});
