# Disagreement tiering
Return {"hypotheses":[{"disagreementIds":["<exact requested id>"],"hypothesis":"<claim>","tier":"factual"|"interpretive","tierReason":"<reason>"}]}.
Cover every requested disagreement exactly once. Preserve IDs; do not combine source entities by name.
Factual claims can be established by declared/enforced source evidence; interpretation/modeling choices remain interpretive.
Optional gatedOn:"category" is a recorded dependency only, never an executable gate.
