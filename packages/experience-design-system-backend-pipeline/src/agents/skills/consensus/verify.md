# Source verification
Return {"items":[{"itemId":"<exact requested id>","component":"<assigned name>","source":"<assigned source>","outcome":"confirmed"|"resolved"|"conflicting","resolved":[{"path":"<every requested claim path>","value":"<supported value>"}],"evidence":[{"source":"<exact supplied file>","line":"<covered start-end>","quote":"<exact text>"}],"reason":"<why>"}]}.
Cover every requested item, with unique complete resolutions for every claim before confirmed/resolved.
Quotes must occur in the named file at the stated covered lines. Changed source bytes, missing alternatives, partial evidence or unsupported claims remain conflicting. A confirmation describes the supplied saved source snapshot; retain unverified extraction-byte correspondence explicitly and do not claim runtime or extraction-byte parity.
Preserve declared type alternatives/default/requiredness and distinguish independent source restrictions from observations; declared types and enforced flow can establish relationships when applicable.
No name/framework/shape inclusion recipe, observed-domain narrowing, category gate or automatic field application.
