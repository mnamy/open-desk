export function isWrongProfession(title: string, description: string): boolean {
  const text = `${title}\n${description}`
  const mechanical =
    /\b(solidworks|autocad|\bcad\b|machining|\bcnc\b|mechanical parts|\bhvac\b|structural analysis|mechanical engineering)\b/i
  const creative =
    /\b(browser|\bcss\b|\breact\b|interaction design|creative technologist|interface|figma|user experience)\b/i
  return mechanical.test(text) && !creative.test(description)
}
