# AutoKaggle Use Case

AutoKaggle is an Aura use-case package, not an Aura core scaffold. It is copied
into a normal Aura workspace with `scripts/bootstrap.py`.

```bash
aura new ~/kaggle/playground-s5e1
cd ~/kaggle/playground-s5e1

python /path/to/aura/use-cases/auto-kaggle/scripts/bootstrap.py \
  --slug playground-s5e1 \
  --mode offline

aura workflow doctor
python src/train_candidate.py --run-id baseline_001
aura kernel run_call ak_submit_guard '{"action":"validate","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}'
```

After bootstrap, users should mainly edit `params/autokaggle.yml`.
