import io, re, sys

def resolve(path, keep):
    """keep: list of 'ours'/'theirs', in order of appearance in the file."""
    lines = open(path, encoding="utf8").read().split("\n")
    out, i, k = [], 0, 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("<<<<<<<"):
            ours, theirs = [], []
            i += 1
            while not lines[i].startswith("======="):
                ours.append(lines[i]); i += 1
            i += 1
            while not lines[i].startswith(">>>>>>>"):
                theirs.append(lines[i]); i += 1
            i += 1
            side = ours if keep[k] == "ours" else theirs
            if keep[k] == "theirs_first":
                side = theirs + [""] + ours
            out.extend(side)
            k += 1
        else:
            out.append(ln); i += 1
    assert k == len(keep), f"{path}: 期望 {len(keep)} 处冲突，实际 {k}"
    open(path, "w", encoding="utf8").write("\n".join(out))
    print(f"resolved {path}: {k} 处 -> {keep}")

resolve("scripts/smoke_grok_desktop_parity.sh", ["theirs", "ours", "theirs_first"])

# 聚合门里 G-55/G-56 已经被远端的 GP-166 / GP-168 占了（docs/design/desktop-target/report.md
# 与 parity-gaps-next.md 都按这两个编号写的），所以本次新增的两块顺延成 G-57/G-58。
p = "scripts/smoke_grok_desktop_parity.sh"
lines = open(p, encoding="utf8").read().split("\n")
start = next(i for i, l in enumerate(lines) if "G-55 事件日志底座" in l)
end = next(i for i, l in enumerate(lines) if i > start and "先跑：moon build --target native --release" in l)
for i in range(start, end + 1):
    lines[i] = (lines[i]
                .replace("G-55", "G-57").replace("G-56", "G-58")
                .replace("g55-eventlog", "g57-eventlog").replace("g56-kernel-resident", "g58-kernel-resident"))
open(p, "w", encoding="utf8").write("\n".join(lines))
print(f"renumbered 我的两块：行 {start + 1}-{end + 1} → G-57 / G-58")

