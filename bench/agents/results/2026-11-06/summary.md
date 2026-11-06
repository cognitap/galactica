# Agent benchmark summary

144 runs, $20.36 in all. Models: opus = claude-opus-5-5, sonnet = claude-sonnet-5-5.

## By model and condition

Accuracy and cost are means over runs, turns and tool calls medians. "Galactica used" counts runs that loaded the skill or ran a Galactica command.

| Model  | Condition  | Runs | Accuracy | Cost per run | Turns | Tool calls | Galactica used | Errors |
| ------ | ---------- | ---- | -------- | ------------ | ----- | ---------- | -------------- | ------ |
| opus   | without    | 24   | 94%      | $0.180       | 7     | 6          | 0%             | 0      |
| opus   | skill      | 24   | 99%      | $0.206       | 9     | 7          | 79%            | 0      |
| opus   | instructed | 24   | 100%     | $0.211       | 8     | 6          | 100%           | 0      |
| sonnet | without    | 24   | 82%      | $0.082       | 6.5   | 5.5        | 0%             | 0      |
| sonnet | skill      | 24   | 82%      | $0.080       | 6     | 4          | 17%            | 0      |
| sonnet | instructed | 24   | 93%      | $0.088       | 7     | 5          | 100%           | 0      |

## By task

Each cell: accuracy · cost per run · runs that used Galactica.

| Task        | Model  | without             | skill               | instructed          |
| ----------- | ------ | ------------------- | ------------------- | ------------------- |
| hono-rename | opus   | 100% · $0.274 · 0/4 | 100% · $0.312 · 3/4 | 100% · $0.312 · 4/4 |
| hono-rename | sonnet | 100% · $0.168 · 0/4 | 100% · $0.168 · 0/4 | 100% · $0.167 · 4/4 |
| hono-tests  | opus   | 65% · $0.115 · 0/4  | 92% · $0.122 · 4/4  | 100% · $0.121 · 4/4 |
| hono-tests  | sonnet | 44% · $0.041 · 0/4  | 58% · $0.041 · 0/4  | 81% · $0.038 · 4/4  |
| nest-impact | opus   | 100% · $0.167 · 0/4 | 100% · $0.135 · 4/4 | 100% · $0.142 · 4/4 |
| nest-impact | sonnet | 100% · $0.070 · 0/4 | 100% · $0.051 · 4/4 | 100% · $0.044 · 4/4 |
| nest-rename | opus   | 100% · $0.285 · 0/4 | 100% · $0.326 · 0/4 | 100% · $0.348 · 4/4 |
| nest-rename | sonnet | 100% · $0.131 · 0/4 | 100% · $0.132 · 0/4 | 100% · $0.163 · 4/4 |
| nest-tests  | opus   | 100% · $0.104 · 0/4 | 100% · $0.160 · 4/4 | 100% · $0.154 · 4/4 |
| nest-tests  | sonnet | 100% · $0.038 · 0/4 | 100% · $0.036 · 0/4 | 100% · $0.051 · 4/4 |
| vite-tests  | opus   | 100% · $0.136 · 0/4 | 100% · $0.184 · 4/4 | 100% · $0.191 · 4/4 |
| vite-tests  | sonnet | 50% · $0.044 · 0/4  | 33% · $0.053 · 0/4  | 75% · $0.065 · 4/4  |

## Tests named

The median number of test files each answer listed.

| Task        | Model  | without | skill | instructed |
| ----------- | ------ | ------- | ----- | ---------- |
| hono-tests  | opus   | 9       | 11.5  | 14.5       |
| hono-tests  | sonnet | 6       | 7.5   | 10         |
| nest-impact | opus   | 13      | 11    | 10.5       |
| nest-impact | sonnet | 8       | 10    | 9.5        |
| nest-tests  | opus   | 5       | 17.5  | 19         |
| nest-tests  | sonnet | 5       | 5     | 8          |
| vite-tests  | opus   | 5       | 8     | 9          |
| vite-tests  | sonnet | 3.5     | 2     | 6.5        |

## Renames

48 of 48 rename runs left no old name, no unparsable file and no change outside the files that held the name.
