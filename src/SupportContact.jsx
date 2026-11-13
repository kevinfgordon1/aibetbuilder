import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "./siteLinks.js";

const defaultLinkStyle = { color: "#93c5fd", fontWeight: 700, textDecoration: "none" };

export default function SupportContact({
  prefix = "Questions? Contact",
  linkStyle = defaultLinkStyle,
  style,
}) {
  return (
    <span data-support-contact="true" style={style}>
      {prefix}{" "}
      <a href={SUPPORT_MAILTO} data-support-email="true" style={linkStyle}>{SUPPORT_EMAIL}</a>
    </span>
  );
}
