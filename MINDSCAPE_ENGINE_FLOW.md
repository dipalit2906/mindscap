## Library Flow & Architecture Diagram

```mermaid
graph TD
    A[User Breath] -->|Raw PCM| B(react-native-live-audio-stream)
    B -->|Base64| C(BreathDetector.tsx)
    C -->|DSP: RMS Gate| D{Gate Passes?}
    D -->|No| E[Exit early - Sleep]
    D -->|Yes| F(react-native-tflite-m)
    F -->|Inference| G(useMindscapeSession.ts)
    G -->|BPM / State| H(react-native-reanimated)
    H -->|Visuals| I(@shopify/react-native-skia)
```

## Library Execution Timeline (Hybrid Logic)

1.  **react-native-live-audio-stream** (The "Raw Ear"): 
    *   **What it does**: Opens the raw PCM stream at 16,000Hz.
    *   **Logic**: Bypasses Android's filters (Source 6) to get the "honest" sound.
2.  **BreathDetector.tsx** (The "Sentry"): 
    *   **What it does**: Manages a 15,600-sample sliding window.
    *   **Logic**: Calculates **RMS (Volume)** first. If it's too quiet, it stops immediately to save battery.
3.  **react-native-tflite-m** (The "Analyst"): 
    *   **What it does**: Runs AI on the full 1-second waveform.
    *   **Logic**: Only runs when the Sentry (RMS) gives permission.
4.  **useMindscapeSession.ts** (The "Judge"): 
    *   **What it does**: The Core Engine.
    *   **Logic**: It takes the AI's data and runs the **Phase Separation**, **BPM Smoothing**, and **State Classification** logic. It decides if you are in "Stabilised," "Expanded," etc.
5.  **react-native-reanimated** (The "Muscle"): 
    *   **What it does**: Syncs the Engine data to the UI.
    *   **Logic**: It takes the BPM and State and converts them into smooth, 60fps "SharedValues." This ensures the screen doesn't lag even when the engine is working hard.
6.  **@shopify/react-native-skia** (The "Painter"): 
    *   **What it does**: Renders the professional meditation ring.
    *   **Logic**: It reads the `SharedValues` and draws the expanding/contracting glow in real-time using GPU acceleration.

## 1. The Audio Input Pipeline
The engine processes audio in 100ms chunks to ensure "Live" feedback.
1.  **Sampling**: Raw microphone data is converted to RMS (Volume), ZCR (Zero Crossing Rate), and Spectral Centroid. 
    *   **Optimization**: We use `Android.AudioSource.VOICE_RECOGNITION` (Source 7) to bypass system-level noise cancellation, ensuring quiet breathing is not filtered out as background noise.
2.  **Natural Smoothing**: The RMS signal is passed through an exponential flywheel (`0.8` smoothing factor) to remove electronic static and jitter.
3.  **Adaptive Calibration**: During the first 10 seconds, the engine samples room noise to set an `adaptiveFloor`. This floor acts as the "Zero Point" for all detection.

## 2. Phase Detection (The "Heart" of the Engine)
The engine moves through three phases in a strict loop: `Silence` -> `Inhale` -> `Exhale`.

*   **Inhale Trigger**: 
    *   Requires a **10% jump** in volume above the noise floor.
    *   Uses **Differential Detection**: If the volume trend is rising by at least 2% over 3 frames, an inhale is confirmed.
*   **Exhale Transition**: 
    *   Triggered when the volume peaks and drops by 15%.
*   **Separation (Valley Detection)**: 
    *   If the volume starts rising *during* an exhale, the engine immediately starts a NEW inhale. This prevents "merging" breaths into one long cycle.
*   **Sticky Exhale**: 
    *   The engine stays in the "Exhale" phase until the volume drops below **30% of the noise floor**, ensuring slow-breathers get credit for the full duration.

## 3. Metric Calculations (The "Brain")
Once an exhale finishes, the engine calculates the metrics used for classification:
*   **Smooth BPM**: Averaged over the **last 3 breaths** to prevent a single glitch from ruining the user's state.
*   **Stabilized Variance**: Calculated over a **6-breath window**. We use a weighted variance to ignore small timing differences (e.g., 8.1s vs 8.2s).
*   **I/E Ratio**: Calculated as `Inhale_Duration / Exhale_Duration`. To reach deep states, the client rules require the Exhale to be significantly longer than the Inhale.

## 4. State Classification (The Client Rules)
We follow the strict PDF thresholds for classification:

| State | BPM | Variance | I/E Ratio | Hold Time |
| :--- | :--- | :--- | :--- | :--- |
| **STABILISED** | < 6 | < 0.15s | < 0.5 (1:2) | 6 sec |
| **EXPANDED** | 6 - 10 | < 0.3s | < 0.67 (1:1.5) | 5 sec |
| **TRANSITION** | 10 - 14 | 0.3s - 0.8s | < 0.83 (1:1.2) | 5 sec |
| **NARROWED** | > 14 | > 0.8s | >= 0.83 | 5 sec |

## 5. Stability & Safety Features
These features were added to solve specific issues found during testing:
*   **Smart Search**: If the room is silent for 6 seconds, the engine aggressively lowers the noise floor to "search" for quiet breathing.
*   **Stale Data Reset**: If no breath is seen for 15 seconds, metrics are reset to 0, and the state returns to **Transition**.
*   **The Transition Bridge**: Prevents the state from jumping directly from Expanded to Narrowed. It must pause at Transition first to ensure a smooth UI experience.
*   **Safety Heartbeat**: If a user takes an ultra-deep breath (> 20s), the engine gives them credit for the breath but resets the phase to prevent getting "stuck" on a high noise spike.

---

## 6. How to Validate the TFLite Model

If you suspect the AI model is not giving proper results, follow these verification steps:

### 1. Check the Initialization Logs
When the app starts, look for these logs in the console:
*   `[TFLITE] Model loaded from: ...`
*   `[TFLITE] Model Inputs: [{"name":"waveform_binary","dataType":"float32","shape":[15600]}]`
*   **If these logs are missing**, the model file (`.tflite`) is not being loaded correctly.

### 2. Monitor Inference Speed
The engine expects an inference every **100ms**. 
*   If the console logs feel "laggy" or take more than 2-3 seconds to appear after you breathe, the model may be struggling with the device's hardware.

### 3. Verify RMS Output vs. Real Volume
In the code, the TFLite model outputs an **RMS (Volume)** value. 
*   **Test**: Blow directly into the microphone. 
*   **Expected Result**: You should see a log like `[ENGINE] Live: Inhale | RMS: 0.00500`. 
*   **Failure Case**: If you blow into the mic and the RMS stays below `0.00010`, the model is not "hearing" the audio correctly.

### 4. Check the ZCR (Sharpness) Filter
The model uses ZCR to distinguish between a "Breath" (Low ZCR) and "Static Noise" (High ZCR).
*   **Test**: Rub your finger over the microphone (creates high-pitched friction).
*   **Expected Result**: You should see the engine ignore this or log `! REJECTED`.
*   **Failure Case**: If rubbing the mic triggers an "Inhale," the ZCR logic is failing.

---
**Developer Note**: The engine is optimized for the **Motorola Edge 50 Fusion**, accounting for its specific microphone gain and noise cancellation profile.
