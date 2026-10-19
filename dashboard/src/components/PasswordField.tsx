import { useState } from "react";

export function PasswordField({ id, value, onChange, autoComplete = "new-password", describedBy, minLength }: {
  id: string; value: string; onChange: (value: string) => void;
  autoComplete?: "new-password" | "current-password"; describedBy?: string; minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="password-field">
    <input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} required
      minLength={minLength} maxLength={256} value={value} aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)} />
    <button type="button" className="password-toggle" aria-label={`${visible ? "Hide" : "Show"} ${id === "confirm-password" ? "confirmed password" : "password"}`} aria-pressed={visible}
      onClick={() => setVisible((current) => !current)}>{visible ? "Hide" : "Show"}</button>
  </div>;
}
