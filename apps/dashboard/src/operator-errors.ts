/** Keep hardware internals in an expandable detail, never expose stream keys. */
export function operatorError(message: string): { summary: string; detail: string } {
  const detail = message.replace(/rtmps?:\/\/[^\s"']+/gi, "[stream URL hidden]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [hidden]")
    .replace(/((?:streamKey|refresh_token|access_token|client_secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[hidden]");
  let summary = detail;
  if (/CAPTURE_INPUT_BUSY|Capture input is already active|Camera already in use|Microphone already in use/i.test(detail))
    summary = "This camera or microphone is already being used. Check the ring's device assignment and active outputs.";
  else if (/ambiguous|Multiple microphones|Saved microphone is disconnected|Microphone not found/i.test(detail))
    summary = "The assigned microphone cannot be identified. Choose its individual device in Settings.";
  else if (/UDP port collision|transport port.*reserved/i.test(detail))
    summary = "Two cameras have conflicting internal transport assignments. Review device configuration.";
  else if (/OPERATOR_LOCKED|Operator unlock required/i.test(detail)) summary = "Unlock operator controls before making this change.";
  else if (/Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT/i.test(detail)) summary = "The streaming PC could not be reached. Check its connection before trying again.";
  else if (/insufficient.*(?:space|storage)|disk.*(?:critical|full)|not enough.*(?:space|storage)/i.test(detail)) summary = "There is not enough recording storage. Choose another recording folder or free up space.";
  else if (/FFmpeg|DirectShow|@device_|(?:[A-Z]:\\[^\s]+)/i.test(detail)) summary = "The media operation could not be completed. Open technical details for troubleshooting.";
  return { summary, detail };
}
