# MindScape MVP: Full Technical & Behavioral Specification (V1.1)

## 1. PROJECT PHILOSOPHY & UX CONSTRAINTS
* **The "Mirror" Principle:** The environment reflects the user’s state; it never instructs or guides. 
* **Invisible UI:** 
    * **REMOVE** all visible metrics (BPM, %, state labels) during the session.
    * **MINIMIZE** explanatory text. Let transitions carry the experience.
    * **SOFT CLOSURE:** The session ending must feel like a "quiet fade" rather than an "achievement unlocked" or "performance summary."
* **Awareness Moment:** The "Aha!" moment when the user realizes the connection. This remains purely environmental with no text.

---

## 2. STATE ENGINE: THE 4 PERCEPTION FIELDS
The system must classify internal states based on Breath Rate (BPM) and maintain them via specific transition rules.

| Field | BPM Range | Visual Rendering | Audio Character (Field) |
| :--- | :--- | :--- | :--- |
| **NARROWED** | > 14 BPM | Warm red-coral; tight/compressed rings; 60-70% size; rapid oscillation. | Tense, dry breath textures; edge-tones; subtle friction; **0% Ney presence**. |
| **TRANSITION** | 10–14 BPM | Warm amber; **Asymmetric/offset rings**; directional motion. | Wavering harmonics; unstable resonance; **25% Ney presence**. |
| **EXPANDED** | 6–10 BPM | Cool teal; wide ring spacing; 85-100% size; slow 6-8s cycles. | Open breath-like textures; spacious overtones; **65% Ney presence**. |
| **STABILISED** | < 6 BPM | Soft green (desaturated); nearly static; 10-14s cycles. | Minimal sustained resonance; near-silence; warm drone; **100% Ney presence**. |

---

## 3. AUDIO IMPLEMENTATION (RESPONSIVE SYSTEM)
Audio is a **first-class entity** and must lead the visuals.
* **Axis 1: Breath-Sync (Real-Time):**
    * **Inhale Phase:** Volume/Gain ramps to 1.0 (linear/exponential) over ~400ms.
    * **Exhale Phase:** Volume/Gain ramps down to 0.2 over ~500ms.
* **Axis 2: Field-State Mapping:** 
    * Cross-fade between 4 parallel audio buffers based on the current Perception Field.
    * **Transition Lead:** Audio transitions must begin **0.3s before** visual transitions.
* **Axis 3: The "Ney" Meta-Layer:**
    * A flute-like texture that emerges gradually. It is **absent** in Narrowed and reaches **full presence** in Stabilised.
* **Responsive Fragments:** Instead of a static loop, the system should feel like "fragments" combining dynamically based on internal state.

---

## 4. VISUAL MAPPING & TRANSITION LOGIC
* **Transition Entities:** Every state change **must** pass through the "Transition Field" renderer. Direct jumps (e.g., Narrowed → Expanded) are forbidden.
* **The Awareness Moment Trigger:**
    * **Condition:** Triggered on the *first* field shift (any direction) after 45 seconds of session time.
    * **Visual Execution:** Outermost ring expands to 130% size; second ring expands 0.3s later (ripple effect). Duration: 3s.
* **Classifier Frequency:** The state engine must evaluate input every **500ms**.
* **State Locking:** A new state must be held for **X seconds** (refer to classifier logic) before the environment fully commits to the transition.

---

## 5. HARDWARE & INPUT FALLBACKS
* **Primary Input:** Microphone (DSP Engine).
    * Detects breath peaks for BPM and phase (Inhale/Exhale).
* **Fallback (Touch Mode):**
    * **Press Down:** Mimics Inhale (Volume up / Ring expansion).
    * **Release:** Mimics Exhale (Volume down / Ring contraction).
    * **3-State Logic:** Uses touch frequency to simulate Constricted, Open, or Regulated states.

---

## 6. SPRINT 1 ARCHITECTURAL REQUIREMENTS
1.  **Modular Audio Graph:** Must support 4 field GainNodes + 1 Meta-GainNode (Ney) + Master Gain (Breath sync).
2.  **Visual Adapter:** Must handle independent Ring objects with properties for: Color (HEX), Size (%), Opacity, Oscillation Speed, and Offset (Asymmetry).
3.  **Data Logging:** For research, log the exact timestamp and BPM of the "Awareness Moment" and the direction of the state shift (improving vs. regressing).
