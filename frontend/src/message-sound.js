// A short, locally synthesized chime; no audio downloads or tracking requests.
export function createMessageSound() {
  let context;
  return {
    async unlock() {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error("Sound is not supported in this browser.");
      context ||= new Audio();
      if (context.state !== "running") await context.resume();
      return context.state === "running";
    },
    play() {
      if (context?.state !== "running") return false;
      [660, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        const start = context.currentTime + index * 0.13;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.23);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.25);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      });
      return true;
    },
    close() {
      void context?.close().catch(() => {});
      context = undefined;
    },
  };
}
