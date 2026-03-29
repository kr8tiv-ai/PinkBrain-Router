@echo off
echo ========================================
echo  PinkBrain Router - Push to GitHub
echo ========================================
echo.

cd /d "C:\Users\lucid\Desktop\Pinkbrain router git"

echo [1/4] Checking status...
git status
echo.

echo [2/4] Staging files...
git add README.md PRD.md .gitignore backend\.env.example backend\.gitignore
echo.

echo [3/4] Committing...
git commit -m "feat: polished README with architecture docs, badges, and getting started guide"
echo.

echo [4/4] Pushing to origin/main...
git push -u origin main
echo.

echo ========================================
echo  Done! Check https://github.com/kr8tiv-ai/PinkBrain-Router
echo ========================================
pause
