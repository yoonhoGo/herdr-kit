const matches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// Read only the URL authority and path. Agent-supplied labels do not identify the site.
export function referenceSite(url) {
  const [, authority = "", path = ""] = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(url) ?? [];
  const address = authority.slice(authority.lastIndexOf("@") + 1);
  const host = (address.startsWith("[") ? address.slice(0, address.indexOf("]") + 1) : address.split(":", 1)[0])
    .toLowerCase().replace(/\.$/, "");
  const atlassian = matches(host, "atlassian.net");
  let icon = "globe";
  if (matches(host, "github.com")) icon = "github";
  else if (matches(host, "slack.com")) icon = "slack";
  else if ((atlassian && /^\/wiki(?:\/|$)/i.test(path)) || matches(host, "confluence.com")) icon = "confluence";
  else if (atlassian || matches(host, "jira.com")) icon = "jira";
  return { host, icon };
}
