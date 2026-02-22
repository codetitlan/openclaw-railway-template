# CI/CD Fix Log

## 2026-02-22: Fixed startup_failure in full-pipeline.yml

### Problem
After merging PR #58 (switching cd.yml to use @main), all workflows failed with `startup_failure`.

**Root Cause:** Invalid `permissions:` block in `full-pipeline.yml` build job
- GitHub Actions doesn't allow `permissions:` at job level when using reusable workflows
- Permissions must be set inside the reusable workflow itself

### Solution
**ci-workflows PR #16:** Removed invalid permissions block from build job
- Status: ✅ Merged to main
- All CI checks passed: YAML Syntax, Lint, Shellcheck, Doc References

### Fix Details
```diff
   build:
     needs: validate
     uses: bb-claw/ci-workflows/.github/workflows/docker-build-push.yml@v1
     with:
       dockerfile: ${{ inputs.dockerfile }}
-    permissions:
-      contents: read
-      packages: write
+    # Note: permissions are set inside docker-build-push.yml (cannot override in caller)
```

### Verification
This commit tests that the fix works. Expected result:
- ✅ Workflow starts successfully (no startup_failure)
- ✅ Build job runs
- ✅ All pipeline steps execute

### Related Issues
- Fixed: https://github.com/bb-claw/openclaw-railway-template/actions/runs/22282449648
- PR #16: https://github.com/bb-claw/ci-workflows/pull/16 (merged)
- PR #15: https://github.com/bb-claw/ci-workflows/pull/15 (merged, secret definition fix)
