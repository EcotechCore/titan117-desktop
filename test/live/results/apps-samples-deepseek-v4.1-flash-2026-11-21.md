# Five sample web apps with deepseek/deepseek-v4.1-flash

## Cluj Bakery (restaurant)

Task: done, 6 steps, $0.0184. Checks: pass.

Asked:
- app_create: Make a new web app "Cluj Bakery" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp
- app_plan: Build this plan in "Cluj Bakery"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each c

Versions:
- Built: Build a one-page site for "Cluj Bakery", a bakery in Cluj-Napoca, in R
- Version 1: a new web app, "Cluj Bakery", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```

## Ana Plumbing (services)

Task: done, 3 steps, $0.0265. Checks: pass.

Asked:
- app_create: Make a new web app "Ana Plumbing" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp
- app_plan: Build this plan in "Ana Plumbing"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 

Versions:
- Built: Build a small three-page site for "Ana Plumbing", a plumber in Cluj-Na
- Version 1: a new web app, "Ana Plumbing", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```

## Atelier Lemn (shop)

Task: done, 4 steps, $0.0605. Checks: pass.

Asked:
- app_create: Make a new web app "Atelier Lemn" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\atelier-lemn: find src public -type f | sort · runs find
- app_plan: Build this plan in "Atelier Lemn"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\atelier-lemn: find src -type f | sort · runs find
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\atelier-lemn: node -e "const s=require('./site.config.json'); const t=[s.ti
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\atelier-lemn: ls node_modules >/dev/null 2>&1 && echo "node_modules present

Versions:
- Built: Build a catalogue site for "Atelier Lemn" (handmade wooden furniture a
- Version 1: a new web app, "Atelier Lemn", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```

## Ioana Pop Photography (portfolio)

Task: stopped, 2 steps, $0.0938. Checks: fail.

Asked:
- app_create: Make a new web app "Ioana Pop Photography" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: ls -la; echo "---"; git log --oneline -5 2>/dev/null
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: find src -type f | sort; echo "---"; ls public .tita
- app_plan: Build this plan in "Ioana Pop Photography"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a versi
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: node -e "const s=require('./site.config.json'); cons
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: node -e "
const lum=(h)=>{const c=h.replace('#','').
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: node -e "
const lum=(h)=>{const c=h.replace('#','').
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: node -e "
const lum=(h)=>{const c=h.replace('#','').
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: node -e "
const lum=(h)=>{const c=h.replace('#','').
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: node -e "const s=require('./site.config.json'); cons
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: ls node_modules 2>/dev/null | head -3; echo "exit:$?
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp\ioana-pop-photography: node -e "
const hex=(r,g,b)=>'#'+[r,g,b].map(v=>Math

Versions:
- Version 1: a new web app, "Ioana Pop Photography", from the template

```
no report
```

## Tax Day 2027 (landing)

Task: done, 6 steps, $0.0203. Checks: pass.

Asked:
- app_create: Make a new web app "Tax Day 2027" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VrI2jp
- app_plan: Build this plan in "Tax Day 2027"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 

Versions:
- Built: Build a one-page landing page for a free one-day workshop called "Tax
- Version 1: a new web app, "Tax Day 2027", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```


## Summary

| App | Checks | Versions | Steps | Cost | Minutes |
|---|---|---|---|---|---|
| Cluj Bakery | pass | 2 | 6 | $0.018 | 2.8 |
| Ana Plumbing | pass | 2 | 3 | $0.027 | 4.2 |
| Atelier Lemn | pass | 2 | 4 | $0.061 | 4.6 |
| Ioana Pop Photography | FAIL | 1 | 2 | $0.094 | 15.0 |
| Tax Day 2027 | pass | 2 | 6 | $0.020 | 2.3 |