export default function GuestLock({ locked = true }) {
  if (!locked) return null;
  return (
    <svg
      className="guest-lock"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ display: "inline-block", flex: "0 0 auto", verticalAlign: "-1px" }}
    >
      <path
        fill="currentColor"
        d="M12 1.8A4.2 4.2 0 0 0 7.8 6v2.2H7a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9.8a2 2 0 0 0-2-2h-.8V6A4.2 4.2 0 0 0 12 1.8zm0 1.8a2.4 2.4 0 0 1 2.4 2.4v2.2H9.6V6A2.4 2.4 0 0 1 12 3.6z"
      />
    </svg>
  );
}
