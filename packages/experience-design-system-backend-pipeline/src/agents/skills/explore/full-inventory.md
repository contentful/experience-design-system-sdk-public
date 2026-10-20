# Selected component inventory
Inventory every requestedComponents entity from the supplied human-confirmed accepted selection in the assigned full-inventory scope. Return exactly one entry for every assigned name/source/componentId; do not omit an entity when its evidence is unavailable, and record that uncertainty in modelingNotes.
Return one JSON object: {"agentRole":"<assigned scope>","components":[{"name":"<name>","source":"<source>","componentId":"<id>","props":[{"name":"<source name>","type":"<declared type>","description":"<purpose>","required":false,"reasoning":"<source evidence>"}],"slots":[]}]}.
Preserve the complete declared alternatives, open/finite domain, source default and requiredness. Omit unsupported fields and record modelingNotes.
A few caller literals, defaults, switch/lookup observations or shape/category guesses are not an exhaustive source domain.
Preserve render input/callback names and distinguish source purpose from target representation; source constraints win over optional existing-model alignment.
Invent no category gate or resolved field application. This inventory is evidence for recorded human review, not authorization to alter the source facts.
