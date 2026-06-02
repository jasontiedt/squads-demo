param([int[]]$worktrees=@(85))
foreach ($n in $worktrees) {
  $wt = "C:\GitRepos\squads-demo-$n"
  if (Test-Path $wt) {
    foreach ($p in @("node_modules","apps\web\node_modules","apps\worker\node_modules","packages\schema\node_modules","packages\rules\node_modules","packages\assets-meta\node_modules")) {
      $full = Join-Path $wt $p
      if (Test-Path $full) { cmd /c "rmdir `"$full`"" 2>$null }
    }
  }
}
