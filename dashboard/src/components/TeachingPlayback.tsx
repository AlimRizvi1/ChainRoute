import { useEffect, useRef, useState } from "react";

export function useTeachingPlayback(count: number, runId?: string) {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [motion, setMotion] = useState(() => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => { if (query?.matches) { setMotion(false); setPlaying(false); } };
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setStep(0);
    setPlaying(Boolean(runId) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }, [runId]);
  useEffect(() => {
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? true; update(); }, { threshold: .1 });
    if (root.current) observer?.observe(root.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    if (!playing || !visible || step >= count - 1) return;
    const timer = setTimeout(() => setStep(value => Math.min(value + 1, count - 1)), 1800 / speed);
    return () => clearTimeout(timer);
  }, [playing, visible, step, count, speed]);
  const seek = (value: number) => { setPlaying(false); setStep(Math.max(0, Math.min(count - 1, value))); };
  return { root, step, playing: playing && step < count - 1, motion, visible, speed, setSpeed, setMotion, seek,
    toggle: () => { if (step === count - 1) setStep(0); setPlaying(value => step === count - 1 || !value); },
    replay: () => { setStep(0); setPlaying(true); } };
}

export function TeachingControls({ playback, count, label, disabled = false }: {
  playback: ReturnType<typeof useTeachingPlayback>; count: number; label: string; disabled?: boolean;
}) {
  return <div className="teaching-controls" role="group" aria-label={`${label} playback controls`}>
    <button type="button" className="secondary-button" disabled={disabled} onClick={playback.toggle}>{playback.playing ? `Pause ${label}` : `Play ${label}`}</button>
    <button type="button" className="secondary-button" disabled={disabled || playback.step === 0} onClick={() => playback.seek(playback.step - 1)} aria-label={`Previous ${label} step`}>Previous</button>
    <button type="button" className="secondary-button" disabled={disabled || playback.step === count - 1} onClick={() => playback.seek(playback.step + 1)} aria-label={`Next ${label} step`}>Next step</button>
    <button type="button" className="text-link" disabled={disabled} onClick={playback.replay}>Replay {label}</button>
    <label>Speed<select aria-label={`${label} playback speed`} value={playback.speed} onChange={event => playback.setSpeed(Number(event.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
    <label className="motion-toggle"><input type="checkbox" checked={playback.motion} onChange={event => playback.setMotion(event.target.checked)} />Motion</label>
  </div>;
}
