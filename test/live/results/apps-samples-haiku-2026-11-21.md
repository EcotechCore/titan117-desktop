# Five sample web apps with anthropic/claude-haiku-5.5

## Cluj Bakery (restaurant)

Task: done, 3 steps, $0.0233. Checks: pass.

Asked:
- app_create: Make a new web app "Cluj Bakery" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VD0XWl
- app_plan: Build this plan in "Cluj Bakery"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each c

Versions:
- Built: Build a one-page website for "Cluj Bakery", a bakery in Cluj-Napoca. S
- Version 1: a new web app, "Cluj Bakery", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```

## Ana Plumbing (services)

Task: done, 3 steps, $0.0417. Checks: pass.

Asked:
- app_create: Make a new web app "Ana Plumbing" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VD0XWl
- app_plan: Build this plan in "Ana Plumbing"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 

Versions:
- Built: Build a small three-page site (Home, Services, Contact) for "Ana Plumb
- Version 1: a new web app, "Ana Plumbing", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```

## Atelier Lemn (shop)

Task: done, 3 steps, $0.0313. Checks: pass.

Asked:
- app_create: Make a new web app "Atelier Lemn" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VD0XWl
- app_plan: Build this plan in "Atelier Lemn"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 

Versions:
- Built: A catalogue site with three pages: Home, Products and Contact.
- Version 1: a new web app, "Atelier Lemn", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```

## Ioana Pop Photography (portfolio)

Task: done, 5 steps, $0.0797. Checks: pass.

Asked:
- app_create: Make a new web app "Ioana Pop Photography" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VD0XWl
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VD0XWl\ioana-pop-photography: cat AGENTS.md; echo ---; cat site.config.json; echo 
- app_plan: Build this plan in "Ioana Pop Photography"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a versi
- code_command: Run in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VD0XWl\ioana-pop-photography: mkdir -p src/data src/pages src/components src/lib &
- memory_save: Remember: "Ioana Pop Photography is a wedding and family photographer in Brașov; her contact email is ioana@example.com." (this task has rea

Versions:
- Built: Build a portfolio site for Ioana Pop Photography, a wedding and family
- Version 1: a new web app, "Ioana Pop Photography", from the template

```
All checks passed (typecheck, build, test, browsers).
```

## Tax Day 2027 (landing)

Task: done, 3 steps, $0.0304. Checks: pass.

Asked:
- app_create: Make a new web app "Tax Day 2027" in C:\Users\dniss\AppData\Local\Temp\titan117-samples-VD0XWl
- app_plan: Build this plan in "Tax Day 2027"? Titan writes the code, installs the app's packages, runs its checks and tests, and saves a version. Each 

Versions:
- Built: A landing page for a free one-day workshop on Romanian e-invoicing for
- Version 1: a new web app, "Tax Day 2027", from the template

```
All checks passed (install, typecheck, build, test, browsers).
```


## Summary

| App | Checks | Versions | Steps | Cost | Minutes |
|---|---|---|---|---|---|
| Cluj Bakery | pass | 2 | 3 | $0.023 | 2.1 |
| Ana Plumbing | pass | 2 | 3 | $0.042 | 4.1 |
| Atelier Lemn | pass | 2 | 3 | $0.031 | 2.9 |
| Ioana Pop Photography | pass | 2 | 5 | $0.080 | 8.4 |
| Tax Day 2027 | pass | 2 | 3 | $0.030 | 2.7 |