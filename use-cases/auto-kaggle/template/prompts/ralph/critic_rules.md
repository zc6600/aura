# AutoKaggle Critic Rules

Return completed=true only if:

- The submission exists.
- Columns exactly match sample_submission.csv.
- Row count exactly matches sample_submission.csv.
- ID order exactly matches sample_submission.csv.
- There are no missing prediction values.
- The run exists in the experiment registry with a CV score.
- No Kaggle submission was performed by the verifier.
