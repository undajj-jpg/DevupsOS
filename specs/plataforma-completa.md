# DevUps Growth OS — La Plataforma Completa

> Documento único con TODO: estrategia, arquitectura, guardrails, modelo de datos, cada módulo en detalle, los agentes, el roadmap y el endurecimiento. Generado el 2026-07-26. Build en Claude Code.

## Índice
1. Prompt maestro (overview del sistema)
2. Gobierno del build — CLAUDE.md (reglas no-negociables)
3. Estrategia — Plan del motor de leads
4. Estrategia — Informe de fuentes de leads
5. Núcleo — Motor base de outreach
6. Núcleo — Sourcing (Gojiberry + Apollo + Anymail)
7. Núcleo — Personalización con señal
8. Núcleo — Deliverability a escala
9. Núcleo — Anti-reenvío (escaneo de buzones)
10. Conversión — Respuestas y calificación
11. Conversión — Redactor IA con voz y contexto
12. Conversión — Tablero de pipeline y funnels
13. Conversión — Calendario y agendamiento
14. Entrega — Integración de talento + matching + shortlist
15. Inteligencia — Búsqueda universal y memoria
16. Inteligencia — Conexión de conversaciones y contexto proactivo
17. Inteligencia — Perfil de contacto 360 y prep de reunión
18. Inteligencia — Briefing diario
19. Inteligencia — Asistente conversacional con voz
20. Inteligencia — Jarvis (copiloto de voz con skills)
21. Inteligencia — Auto-etiquetado por tema
22. Inteligencia — Módulo de documentos
23. Equipo — Equipo, buzones y permisos
24. Equipo — Agente de operaciones en WhatsApp
25. Gobierno — Analytics + A/B testing
26. Gobierno — CRM, ICP loop, agent-ops, privacidad
27. Arquitectura — Mapa de los 12 agentes
28. Endurecimiento — Checklist (seguridad + ops)
29. Índice de documentos del proyecto



<div style="page-break-before:always"></div>

---

# DevUps Growth OS — Master Build Spec (para Claude Code)

> Prompt maestro autocontenido. Construí este sistema respetando SIEMPRE la sección **Guardrails** por encima de cualquier feature. Construí en el **orden del Roadmap** (núcleo validado primero). Los agentes corren en **modo sugerencia** hasta pasar la **Puerta de autonomía**.

---

## 0 · Cómo trabajar
- Stack fijo (§2). Código TypeScript estricto, tests con cada feature, migraciones versionadas.
- No mergees sin revisar; corré `/security-review` en lo sensible. Nada de secretos en git.
- Empezá por el **núcleo** (§8 Roadmap, Fase 1) y validá economía antes de sumar capas.

## 1 · Qué es
Plataforma de growth para **DevUps** (staff-augmentation nearshore). Consigue leads → verifica emails → outreach personalizado y con warmup → clasifica respuestas con IA → agenda reuniones → entrega **shortlists de devs** (matching contra el sistema de talento externo, vía MCP). Todo operado por un enjambre de agentes con **Jarvis** (voz) al frente, medido y gobernado, multi-usuario con permisos.

## 2 · Stack
TypeScript (Node 20). API/workers: Fastify o NestJS. **Postgres con RLS** (Drizzle/Prisma, migraciones versionadas) + `pgvector`. Colas: BullMQ + Redis. **Scheduler de infraestructura** (no in-app). Secrets: Doppler/AWS SM + KMS. Observabilidad: OpenTelemetry + Sentry. LLM detrás de un wrapper propio con **function-calling estricto**. STT: Deepgram/Whisper; TTS: ElevenLabs/OpenAI; wake word: Picovoice.

## 3 · GUARDRAILS (no-negociables, aplican a todo)
1. **Secretos:** cero en git; solo secrets manager; tokens OAuth cifrados con KMS, scopes mínimos, rotación; `gitleaks` en CI.
2. **Prompt injection:** todo input externo (emails/replies/WhatsApp/adjuntos) es **dato no confiable, nunca instrucción**. Separar SYSTEM vs CONTENIDO. **Ninguna acción irreversible se dispara desde contenido externo.** LLM solo vía function-calling con esquemas estrictos + allow-list de tools por agente.
3. **Auth & aislamiento:** MCP/APIs con auth real (no `?token=`), TLS, rate limit, validación. **RLS en Postgres** como fuente de aislamiento.
4. **Datos:** cifrado en tránsito/reposo, audit log, minimización, retención/purga, **DSR** (export/delete), backups con restore probado.
5. **Agentes:** human-in-the-loop para lo irreversible; kill switch global + por agente; dry-run; umbrales de confianza; presupuestos/rate caps por agente; trazas auditables.
6. **Ops:** scheduler real; **idempotencia** en envíos (dedupe key lead+campaña); colas + reintentos + dead-letter; circuit breakers; degradación elegante; transacciones.
7. **Compliance:** **supresión pre-envío bloqueante** (clientes/deals/bajas) + anti-reenvío; unsubscribe + dirección física; opt-out cross-canal; revisión legal por región.

## 4 · Modelo de datos (núcleo)
- **orgs, users** (role owner/admin/member), **mailboxes** (user_id, domain_id, oauth token ref, warmup_stage, daily_cap, health, status).
- **accounts** (empresa, relationship prospect/customer/partner), **contacts** (+contact_identities por canal), **leads** (contact_id, account_id, funnel_id, stage, close_probability, intent, score, language, phone, opt_in).
- **funnels** (stages jsonb, rules, active), **lead_tags**, **topics** + **message_topics**.
- **email_log / messages** (channel, mailbox_id, assigned_user_id, thread_id, status), **replies** (category, sentiment, close_probability, draft), **follow_ups**.
- **suppression**, **contacted_registry** (email único/org, first/last, by_mailbox, source), **consent_log**.
- **needs, matches, shortlists, talent_cache** (entrega). **documents** (+versions, smart_views, templates).
- **voice_profiles, memory documents/chunks (vector), briefings, meetings, availability_rules**.
- **skills** (+invocations), **agent_traces, budgets, outcomes, icp_weights, experiments/variants/assignments/events, domains, dsr_requests, retention_policies, audit_log**.
- Toda tabla con `org_id`; **RLS**: fila visible si es owner/admin, o `assigned_user_id = auth.uid()`, o hay `visibility_grant`.

## 5 · Módulos (qué hace cada uno)

**Núcleo (Fase 1)**
- **Motor & Envío:** dedup + **anti-reenvío** (escaneo continuo de todos los buzones → `contacted_registry`) + supresión bloqueante; prioriza por score/intención; envía por Gmail API multi-buzón con **warmup, rotación, límites y salud**; idempotente; scheduler real. Idioma EN/PT/ES.
- **Sourcing:** Gojiberry + Apollo (+ TheirStack) → dedup → **Anymail Finder** (verifica email, solo válidos) → import a `leads` con reglas de idioma/prioridad.
- **Personalización con señal:** primer toque cita el disparador real del lead (vacante/tech stack/ronda), generado por el redactor; fallback genérico; listo para A/B.
- **Deliverability a escala:** dominios/buzones secundarios, warmup automático, rotación, seed/placement tests, monitoreo DMARC; aísla el dominio principal.

**Conversión (Fase 2)**
- **Respuestas/Triage:** detecta replies (Gmail), clasifica (categoría, sentimiento, **prob. de cierre**), rutea; corta cadencia.
- **Redactor IA (voz + contexto):** borradores en la voz de cada miembro, con contexto (hilo + CRM + memoria) y assets proactivos; aprende de las ediciones. Human-in-the-loop en lo caliente.
- **Cadencia de follow-up:** +3d/+7d/+14d; se corta ante respuesta/baja.
- **Pipeline & Funnels:** kanban configurable, múltiples funnels, drag&drop, tags por tema, filtros.
- **Calendario & agendamiento:** Google/Outlook free/busy → propone horarios → **auto-book** con Meet → recordatorios; round-robin; zona horaria.
- **Entrega/Talento (MCP):** el motor es **cliente MCP** del sistema de talento (`search_devs`, `get_dev`); captura la **necesidad**, hace **matching** (reglas+semántico), arma **shortlist** que el redactor incluye.

**Inteligencia (Fase 3)**
- **Memoria unificada + búsqueda:** indexa todo (pgvector), Q&A en lenguaje natural con fuentes, RLS.
- **Conexión de conversaciones:** entity resolution cross-canal + timeline único + **contexto proactivo** (surface del asset relacionado).
- **Auto-etiquetado por tema**, **Perfil 360 + prep de reunión**, **Briefing diario priorizado**, **Hub de Documentos** (auto-organiza propuestas/contratos/shortlists), **Jarvis** (voz + **registro de skills** extensible, front-end del orquestador).

**Equipo & Gobierno (transversal)**
- **Equipo/permisos:** roles, un buzón por miembro, visibilidad por RLS. **Agente WhatsApp** (número dedicado): avisa, comandos, log.
- **Analytics + A/B**, **Gobierno**: CRM = fuente de verdad (lee todos los mensajes), **loop resultados→ICP**, **agent-ops** (evals/costo/kill switch/trazas), **privacidad/DSR**.

## 6 · Agentes (orquestador + 12)
Orquestador (delega/escala) + Concierge (WhatsApp/voz) · Sourcing · Copywriter · Envío · Follow-up · Triage · Agendador · Research/360 · Memoria/Bibliotecario · Briefing · Guardianes: Entregabilidad & Salud, Compliance (con veto). Cada agente: allow-list de tools, disparadores, handoffs (ver `/specs/devups-mapa-de-agentes.md`). Corren en **modo sugerencia** hasta la Puerta de autonomía.

## 7 · MCP surface (tools del motor)
`get_stats, get_pipeline_stats, list_pending_leads, preview_email, create_todays_batch, send_batch, pause, resume, import_leads, add_suppression, check_contacted, run_sourcing, list_replies, classify_reply, set_stage, schedule_followup, propose_slots, book_meeting, search_conversations, summarize_contact, get_contact_timeline, find_related, suggest_context, get_briefing, list_funnels, get_board, move_lead, search_documents, generate_document, run_sourcing, list_skills` — todas con auth real + RLS + validación.

## 8 · Roadmap de construcción
- **Fase 0 — Fundamento:** repo + stack + CLAUDE.md + secrets + CI (tests/lint/typecheck/secret-scan) + Postgres/RLS + auth + scheduler + colas + observabilidad.
- **Fase 1 — Núcleo (validar economía):** leads + import + Sourcing/Anymail + dedup/anti-reenvío/supresión + Envío multi-buzón con warmup + Personalización con señal + Pipeline básico + Triage de respuestas + **borradores con aprobación humana**. → medir respuesta→reunión→deal y **costo por reunión**.
- **Fase 2 — Conversión:** redactor con voz, cadencias, calendario/agendamiento, entrega/talento (MCP), analytics + A/B.
- **Fase 3 — Inteligencia:** memoria/búsqueda, conexión/contexto, 360/prep, briefing, documentos, auto-etiquetado, Jarvis + skills.
- **Fase 4 — Autonomía:** solo tras pasar la **Puerta** (§10): activar agentes autónomos con guardrails.
- **Transversal:** equipo/permisos, WhatsApp ops, gobierno/DSR/agent-ops se van sumando desde Fase 1.

## 9 · Definition of Done (cada PR)
Tests + evals (si toca prompts) · lint/type-check/secret-scan en verde · sin secretos · sin acciones irreversibles disparables por input externo · auth+validación+RLS · idempotencia y retries en jobs · `/security-review` en lo sensible · specs/ADR actualizados.

## 10 · Puerta de autonomía (bloqueante)
Ningún agente envía/actúa solo hasta tener: secretos en manager + tokens cifrados · defensa de prompt injection · auth real + RLS · human-in-the-loop en lo irreversible · kill switch · scheduler real + idempotencia · supresión bloqueante. Hasta entonces: **modo sugerencia** (propone, humano confirma).

---
*Specs detallados por módulo en `/specs` (`devups-*-lovable-prompt.md` → renombrar a specs; el nombre "lovable" es histórico, el build va en Claude Code). Índice: `devups-indice-documentos.md`.*


<div style="page-break-before:always"></div>

---

# CLAUDE.md — DevUps Growth OS

> Colocá este archivo en la **raíz del repo**. Claude Code lo lee en cada sesión. Define QUÉ construimos y, sobre todo, las **reglas no-negociables** con las que se construye. Si una tarea choca con una regla de "Guardrails", **la regla gana** — pará y avisá.

---

## 1 · Qué es
Plataforma de growth para DevUps (staff-augmentation nearshore): consigue leads, envía outreach personalizado, clasifica respuestas, agenda, entrega shortlists de devs (vía el sistema de talento por MCP), y lo opera un enjambre de agentes con Jarvis (voz) al frente. Specs por módulo: ver la carpeta `/specs` (los documentos `devups-*-prompt.md`).

## 2 · Stack (recomendado)
- **Lenguaje:** TypeScript (Node 20+), estricto (`strict: true`).
- **Backend:** Fastify o NestJS (API + workers). **DB:** Postgres con **RLS** (Drizzle/Prisma para migraciones versionadas).
- **Colas/jobs:** BullMQ + Redis. **Scheduler:** cron de infraestructura (no in-app).
- **Secrets:** Doppler / AWS Secrets Manager (+ KMS para cifrado de tokens). **Hosting:** Fly/Railway/Render/AWS.
- **Observabilidad:** OpenTelemetry + Sentry. **LLM:** vía un wrapper propio con function-calling estricto.
Cualquier desvío de stack se documenta en un ADR en `/docs/adr`.

## 3 · Arquitectura (resumen)
Motor (leads · dedup · anti-reenvío · envío) → Respuestas (triage + redactor) → Pipeline/Funnels → Entrega (matching de talento por MCP) → capa de inteligencia (Jarvis, memoria, documentos, briefing, agenda, 360) → medición & gobierno. Orquestador + 12 agentes; guardianes (Entregabilidad, Compliance) con veto. Detalle en `/specs`.

---

## 4 · GUARDRAILS NO-NEGOCIABLES  (aplican a TODO el código)

### 4.1 Secretos & tokens
- Cero secretos en código/git. Solo desde el secrets manager. `gitleaks` en pre-commit y CI.
- Tokens OAuth **cifrados con KMS**, por usuario, scopes mínimos, rotación. Aislar por tenant.

### 4.2 Prompt injection  (todo input externo es hostil)
- Emails, replies, WhatsApp y adjuntos son **datos no confiables**, nunca instrucciones. En los prompts, separar explícitamente `SYSTEM/INSTRUCCIONES` de `CONTENIDO DEL USUARIO`.
- **Ninguna acción irreversible se dispara desde contenido externo** (enviar, borrar, agendar, suprimir, gastar). Requiere un gate con validación.
- LLM **solo** vía function-calling con **esquemas estrictos**; validar y parsear toda salida; rechazar lo malformado. Cada agente tiene **allow-list** de tools; no elige fuera de su set.

### 4.3 Auth & aislamiento
- MCP servers y APIs con **auth real** (OAuth/bearer con rotación, no `?token=`), TLS y rate limiting. Validación de input en todo endpoint.
- **RLS en Postgres** como fuente de aislamiento (no confiar en la UI). Roles de DB de menor privilegio.

### 4.4 Datos & privacidad
- Cifrado en tránsito y reposo. **Audit log** de accesos/acciones. Minimización + retención + purga por tipo de dato. **DSR** (export/delete). **Backups cifrados con restore probado**.

### 4.5 Agentes (autonomía)
- **Human-in-the-loop** obligatorio para lo irreversible (enviar a leads reales, suprimir, agendar, gastar).
- **Kill switch** global + por agente. **Dry-run/simulación** antes de ejecutar real (nunca sobre leads reales).
- **Umbrales de confianza:** lo dudoso va a humano. **Presupuestos y rate caps** por agente (LLM/API/voz) con auto-pausa. **Trazas** auditables de cada decisión.

### 4.6 Confiabilidad / Ops
- **Scheduler real** (no "app abierta"). **Idempotencia** en envíos (dedupe key por lead+campaña; nunca doble-envío en retry).
- **Colas + reintentos + dead-letter**; backoff; **circuit breakers** en APIs externas. Degradación elegante (encolar, no crashear). Transacciones para evitar escrituras parciales.

### 4.7 Compliance (outbound)
- **Supresión pre-envío bloqueante** (clientes, deals activos, bajas) + **anti-reenvío** (escaneo de buzones). Unsubscribe + dirección física. Opt-out **cross-canal**. Revisión legal por región.

---

## 5 · Convenciones de código
- Tipos estrictos, sin `any`. Errores tipados. Funciones puras donde se pueda.
- Toda integración externa detrás de un **adaptador** con interfaz propia (Gmail, Apollo, Anymail, Talento-MCP, LLM) → testeable y reemplazable.
- Nada de lógica de negocio en controladores; capa de servicios. Migraciones versionadas.
- Feature flags para lo nuevo. Config por entorno (dev/staging/prod).

## 6 · Definition of Done / PR checklist
- [ ] Tests (unit + integración de lo crítico) y **evals de agentes** si toca prompts.
- [ ] `lint` + `type-check` + **secret scan** en verde.
- [ ] Sin secretos, sin acciones irreversibles disparables por input externo.
- [ ] Endpoints con auth + validación; RLS cubierta; audit donde aplique.
- [ ] Idempotencia y manejo de errores/retries en jobs.
- [ ] Cambios sensibles: correr `/security-review`.
- [ ] Specs/ADR actualizados.

## 7 · Puerta antes de autonomía  (bloqueante)
Ningún agente envía/actúa solo hasta tener: **secretos en manager + tokens cifrados · defensa de prompt injection · auth real + RLS · human-in-the-loop en lo irreversible · kill switch · scheduler real + idempotencia · supresión bloqueante.** Hasta entonces, los agentes corren en **modo sugerencia** (proponen, un humano confirma).

## 8 · Cómo trabajar con Claude Code en este repo
- Empezá cada feature leyendo su spec en `/specs`. Respetá los Guardrails por encima del spec.
- **No mergees código generado sin revisar.** Pedí tests con cada cambio. Usá `/security-review` en lo sensible.
- Construí en este orden macro: **núcleo validado** (motor + sourcing/Anymail + triage + borradores aprobados + pipeline) → medir economía → recién ahí las capas de inteligencia y la autonomía de agentes.


<div style="page-break-before:always"></div>

---

# Motor de leads DevUps — Plan definitivo (Gojiberry + Apollo + Anymail Finder)

Tres herramientas, cada una en su capa, sin solaparse. La clave del diseño: **Anymail Finder es la única capa de email** (encuentra + verifica, y cobra solo por verificados), lo que resuelve el agujero que dejó Gojiberry y mantiene el bounce bajísimo.

---

## Roles — quién hace qué

**Gojiberry = radar de intención.** Detecta señales en LinkedIn: cambió de trabajo, publicó/comentó, lookalikes de tu ICP. Te da la persona (nombre, empresa, cargo, URL de LinkedIn) **pero no el email**. Lo usás para saber *a quién vale la pena contactar ahora*.

**Apollo = base de datos + señales de contratación.** Búsqueda de personas/empresas por ICP, firmografía, y —clave para staffing— **vacantes abiertas** (empresas contratando ingenieros). Encuentra al decisor (VP Eng / CTO / Head of Eng) en empresas objetivo. También trae emails, pero por consistencia y deliverability el email final lo valida Anymail.

**Anymail Finder = capa de email (encontrar + verificar).** Recibe LinkedIn URL o nombre+dominio y devuelve **email verificado**. Pagás solo por los "Valid" (los "risky"/no encontrados son gratis), 97%+ deliverability. Reemplaza el enrich de Gojiberry Y el verificador aparte — un solo proveedor, más simple y más barato.

**Motor de Outreach (tu app Lovable/Supabase) = orquestador + envío.** Ya construido: tabla `leads`, dedup, idioma EN/PT/ES, prioridad por score/intención, supresión, y envío por Gmail 50–100/día con tanda automática.

---

## Flujo de datos

```
Gojiberry (intención)  ─┐
                         ├─►  Anymail Finder  ─►  Motor (dedup/idioma/prioridad)  ─►  Gmail 50–100/día
Apollo (ICP + vacantes) ─┘   (email verificado)                                        │
                                                                                        ▼
                                                              Respuestas → inbox · Rebotes/bajas → supresión · Salud (pausa si >5%)
```

1. **Entrada de señales:** Gojiberry (intención) + Apollo (búsqueda ICP y vacantes).
2. **Email:** por cada persona, Anymail Finder encuentra y verifica el email (input: LinkedIn URL o nombre+dominio). Solo pasan los verificados.
3. **Carga:** se insertan en la tabla `leads` con dedup, idioma y prioridad (más señal de intención/vacantes = más prioridad).
4. **Envío:** la tanda diaria los manda solos.
5. **Loop:** respuestas a tu inbox, rebotes/bajas a supresión, pausa automática si la salud se degrada.

---

## Qué más necesitamos (además de las 3 herramientas)

- **Claves de API** como secrets: `GOJIBERRY_API_KEY` (ya la tenés), `APOLLO_API_KEY`, `ANYMAILFINDER_API_KEY`.
- **El módulo de sourcing en tu app** que orquesta las llamadas (ver prompt actualizado).
- **NO necesitás** verificador aparte (ZeroBounce) ni un waterfall de varios enrichers (Findymail/Dropcontact/Prospeo) — Anymail cubre eso solo. Stack más simple.
- Dedup, supresión y salud de dominio: ya están en el motor.
- Opcional a futuro: **TheirStack** para señales de vacantes más profundas (Fase 3).

---

## Fuentes adicionales para el punto 1 (alimentación)
Todas se enchufan al MISMO embudo (→ Anymail verifica el email → motor). Sumar fuentes es modular. Por tiers:

**Core (arrancar):**
- **Gojiberry** — intención en LinkedIn (cambió de trabajo, actividad, lookalike).
- **Apollo** — base ICP + datos + vacantes abiertas.
- **TheirStack** (~$59/mes) — vacantes de ingeniería a escala; máximo encaje para staff-aug.

**Amplificadores:**
- **Trigify** — engagement en posts + cambios de trabajo en LinkedIn; complementa a Gojiberry con la misma lógica de señal.
- **Crunchbase / Harmonic** — financiamiento y saltos de headcount (presupuesto a punto de desplegarse en contratar).
- **RB2B** (~$149/mes) — de-anonimiza quién visita devups.io; barato, captura interés existente. (Match persona 5–20%: extra, no fuente principal.)

**Escala / opcional:**
- **Clay** — agrega 100+ fuentes en un flujo; puede consolidar varias integraciones en una.
- **LinkedIn Sales Navigator + scraper (Evaboot/Clay)** — la fuente madre para volumen por ICP.
- **Ocean.io** — lookalikes de tus mejores clientes actuales.

Orden recomendado de incorporación: **TheirStack → Trigify → RB2B**, midiendo calidad de cada una antes de escalar. Anymail sigue siendo el único filtro de email para todas.

## Fases

**Fase 0 — conectar (esta semana):**
- Conectar **Apollo** como conector MCP (ya disponible).
- Sacar la **API key de Anymail Finder** (100 créditos gratis para probar) y cargarla en la app.

**Fase 1 — desbloquear Gojiberry (impacto inmediato):**
Los ~228 contactos de alta intención de Gojiberry que quedaron sin email (recién cambió de trabajo + actividad reciente) → pasarlos por **Anymail Finder** (por LinkedIn URL) → obtener email verificado → importar a la campaña. Esto rescata leads que YA tenés y que hoy no podías usar. **Es el primer movimiento de mayor ROI.**

**Fase 2 — Apollo como segunda fuente:**
Búsqueda de ICP en Apollo (VPs/CTOs en software/SaaS/fintech, LATAM + US) + señales de vacantes → Anymail verifica → importar. Suma volumen nuevo con la mejor cobertura de Brasil/México.

**Fase 3 — señal de vacantes propia (opcional, 2-4 semanas):**
Módulo con **TheirStack** que detecta empresas contratando ingenieros y las mete al pipeline. Tu diferencial de largo plazo.

---

## Costos mensuales estimados

| Herramienta | Plan sugerido | Costo | Rol |
|---|---|---|---|
| Gojiberry | tu plan actual | (ya lo pagás) | Intención |
| Apollo.io | Pro | ~$79/mes | ICP + vacantes + datos |
| Anymail Finder | Standard (5.000 verificados) | ~$99/mes | Email verificado |
| **Total nuevo** | | **~$178/mes** | |

A 100 emails/día (~3.000/mes) el plan Standard de Anymail (5.000 verificados) te sobra. Si arrancás más lento, el Starter ($49, 1.000 verificados) alcanza. Recordá: Anymail solo cobra verificados, así que no pagás por los que no encuentra.

---

## Por qué este diseño es bueno
- **Una sola capa de email verificado** = bounce mínimo, deliverability alta, costo predecible (solo pagás lo válido).
- **Redundancia de fuentes** = si una se cae (como el enrich de Gojiberry hoy), las otras siguen.
- **Reusa todo lo ya construido** (motor, dedup, envío, salud).
- **Escala con tu diferencial** (señales de vacantes) sin rehacer nada.

## Fuentes
- [Anymail Finder Pricing — verified-only](https://anymailfinder.com/pricing)
- [Anymail Finder Email Finder API](https://anymailfinder.com/email-finder-api)
- [Apollo.io Pricing 2026 — Salesmotion](https://salesmotion.io/blog/apollo-pricing)


<div style="page-break-before:always"></div>

---

# Fuentes de leads para DevUps — comparación y estrategia (Julio 2026)

DevUps vende staff-augmentation nearshore. Para ese negocio, la señal de intención más valiosa es **"empresa contratando ingenieros"**, y el cuello de botella real es el **email verificado** (lo que se rompió hoy en Gojiberry). Este informe compara fuentes por las tres capas que toda fuente debe resolver: **targeting (a quién), intención (por qué ahora) y enriquecimiento (cómo contactarlo)**.

---

## 1. Bases B2B "todo en uno" (targeting + datos de contacto)

| Herramienta | Precio (2026) | Cobertura LATAM/Brasil | Precisión email | ¿Conector MCP hoy? |
|---|---|---|---|---|
| **Apollo.io** | $0–$119/usuario/mes anual (Free / Basic $49 / Pro $79 / Org $119). Coste real activo: $150–$400/usuario con créditos | **La más fuerte en Brasil y México** | ~60–70% emails válidos | **Sí** (incluye búsqueda de vacantes) |
| **Lusha** | Por créditos/asiento | Buena en Brasil y Colombia (alta adopción LinkedIn) | ~60–70% | **Sí** |
| **Cognism** | Enterprise, contrato | Limitada en LATAM; fuerte compliance EU | ~80% | No |
| **Explorium / Vibe Prospecting** | Por uso | Amplia, orientada a datos+eventos | Variable | **Sí** |

**Lectura para DevUps:** Apollo es el mejor arranque — datos + secuencias + enriquecimiento + señales de vacantes, barato y con la mejor cobertura de Brasil/México (que es la mitad de tu lista actual). Cognism no vale para LATAM salvo como "ancla de compliance" en un stack multi-proveedor.

---

## 2. Enriquecimiento de email (la capa que se te rompió hoy)

Benchmark independiente 2026 (15 herramientas, 5.000 contactos B2B, todos triple-verificados):

| Proveedor | Cobertura | Precisión | Nota |
|---|---|---|---|
| **Findymail** | 70.9% | 95.6% | Mejor balance; hard bounce 1.1% (excelente) |
| **Dropcontact** | 69.4% | 93.1% | Fuerte en Europa, GDPR-friendly |
| **Prospeo** | 45.2% | 92.5% | Menos cobertura, altísima deliverability (98%) |
| **FullEnrich** (waterfall) | ~62% en contactos difíciles | — | Encadena varios proveedores |
| **BetterContact** (waterfall) | 70.1% verificado | — | Multi-fuente, recupera 17% de los difíciles |

**Clave:** ningún proveedor solo supera ~70% de cobertura. Por eso el estándar es **enrich en cascada (waterfall)**: encadenás Findymail → Dropcontact → Prospeo y te quedás con el primero que devuelve email verificado. Esto sube la cobertura por encima del 80% y te da **resiliencia** — si uno se cae (como Gojiberry hoy), los otros siguen. Siempre cerrá con verificación (ZeroBounce/NeverBounce) para mantener el bounce por debajo del 2%.

---

## 3. Señales de contratación — tu diferencial real

Una empresa con 8 vacantes de backend abiertas es un lead perfecto para DevUps. Estas fuentes lo detectan:

| Fuente | Precio | Qué hace |
|---|---|---|
| **TheirStack** | Desde $59/mes; $109 = 1.000 créditos (1 crédito/vacante) | Agrega 180M+ vacantes de 315k+ fuentes (LinkedIn, Indeed, 16k ATS: Greenhouse, Lever, Workable). Filtrás por tamaño, ronda de inversión, industria y **tech stack**: "fintech Serie B contratando ML engineers" |
| **Predictleads** | API, por uso | Similar, orientado a pipelines programáticos |
| **Apollo (job postings)** | Incluido en tu plan Apollo | Señales de vacantes dentro de la misma herramienta |

**Lectura:** TheirStack a ~$0.0015–0.039 por vacante es de lo más barato para cobertura multi-fuente, y es exactamente la intención que a Gojiberry le falta afinar para staffing. Es la pieza sobre la que conviene construir tu fuente propia.

---

## 4. Construir tu propia fuente

Estás bien parado porque ya tenés la app en Lovable/Supabase. Un módulo de "sourcing" alimenta la misma tabla `leads`. Arquitectura:

1. **Descubrimiento por señal**: API de TheirStack → empresas con vacantes de ingeniería que matcheen tu ICP (LATAM + US, software/SaaS, X+ vacantes abiertas).
2. **Contactos**: por cada empresa, identificar al decisor (VP Eng / CTO / Head of Eng) vía Apollo/Lusha.
3. **Enrich en cascada**: Findymail → Dropcontact → Prospeo → verificación. Te quedás con el primer email verificado.
4. **Dedup + almacenamiento**: insertar en tu tabla `leads` existente (ya deduplica).
5. **Cron diario**: correr el pipeline cada mañana y sumar leads nuevos al envío diario.

**Build vs comprar:** comprar (Apollo + Clay) es más rápido y no mantenés scrapers ni te peleás con el ToS de LinkedIn. Construir da control y menor coste marginal a escala, pero suma ingeniería, mantenimiento y riesgo legal (LinkedIn ToS, GDPR/CAN-SPAM). Para vos, el 80% del valor con el 20% del esfuerzo es: **comprar Apollo+Clay ahora, y construir solo la capa de señal de vacantes** (que es tu diferencial).

---

## 5. Recomendación de stack para DevUps

**Fase 1 — ya (esta semana):**
- **Apollo.io** ($79/mes Pro) como segunda fuente: datos + señales de vacantes + mejor cobertura Brasil/México. Se enchufa como conector MCP hoy.
- **Clay** ($185/mes Launch) para enrich en cascada, que arregla el punto débil de emails. Conector MCP disponible.
- Seguir usando Gojiberry cuando su enrich vuelva (redundancia).

Coste Fase 1: ~$265/mes, y deja de depender de una sola fuente.

**Fase 2 — construir (2-4 semanas):**
- Módulo de sourcing por vacantes con **TheirStack** ($59–109/mes) integrado a tu app de Lovable, con enrich en cascada. Ver el prompt de build adjunto.

---

## Qué se puede enchufar hoy como conector MCP
Apollo.io, Clay, Lusha, Explorium (Vibe Prospecting) y Outreach están todos disponibles en el registro de conectores. Apollo y Clay son los dos que recomiendo conectar ya.

---

## Fuentes
- [Apollo.io Pricing 2026 — CloudTalk](https://www.cloudtalk.io/blog/apollo-pricing/)
- [Apollo.io Pricing 2026 — Docket](https://www.docket.io/resources/research/apollo-pricing)
- [Clay Pricing 2026 — Amplemarket](https://www.amplemarket.com/blog/how-much-does-clay-really-cost)
- [Clay Pricing 2026 — Salesmotion](https://salesmotion.io/blog/clay-pricing)
- [TheirStack Pricing & Reviews 2026 — Prospeo](https://prospeo.io/s/theirstack-pricing-reviews-pros-and-cons)
- [TheirStack Review 2026 — SyncGTM](https://syncgtm.com/blog/theirstack-review)
- [Email Finder Benchmark 2026 — Anymail Finder](https://anymailfinder.com/email-finder-benchmark)
- [Best Email Finder APIs 2026 — Prospeo](https://prospeo.io/s/email-finder-api)
- [Cognism vs Lusha vs Apollo 2026 — Appendment](https://appendment.com/blog/cognism-vs-lusha-vs-apollo/)
- [Best B2B Databases for Latin America 2026 — SyncGTM](https://syncgtm.com/blog/best-b2b-database-latin-america)


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — "DevUps Outreach Engine"

> Copiá y pegá todo lo que sigue (desde "Build me…" hasta el final) en Lovable como prompt inicial. Está en inglés porque Lovable rinde mejor así. Después iteramos por partes.

---

Build me a full-stack cold-email outreach app called **DevUps Outreach Engine**. It manages a list of B2B leads and sends a personalized cold email to a limited number of them per day (default 50), in the lead's language, and exposes an **MCP server** so an external AI agent can drive it.

## Tech stack
- Frontend: React + Tailwind, clean dashboard UI.
- Backend: Supabase (Postgres + Edge Functions + Auth).
- Email sending: **Gmail API** via OAuth2. The user connects their own Google account (`francisco.d@devups.io`) and authorizes the `https://www.googleapis.com/auth/gmail.send` scope (add `gmail.readonly` too, for bounce detection). Store the OAuth **refresh token** as a Supabase secret and mint access tokens as needed. Send with `users.messages.send` (build a base64url MIME message with the HTML body + signature). Emails go out from the user's real Gmail and appear in their Sent folder; replies land in their inbox.
- Scheduling: Supabase scheduled Edge Function via `pg_cron` (the autonomous "plan B" sender).

### Gmail OAuth setup (document in README)
1. Create a Google Cloud project, enable the Gmail API.
2. Configure OAuth consent screen, add scopes `gmail.send` + `gmail.readonly`.
3. Create OAuth client credentials; store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the obtained `GMAIL_REFRESH_TOKEN` as Supabase secrets.
4. Provide a one-time "Connect Gmail" button in the dashboard that runs the OAuth flow and saves the refresh token.

## Data model (Postgres)
**leads**
- id (uuid, pk)
- first_name, last_name, email (unique, not null)
- company, job_title, industry, location, country
- linkedin_url, company_url, website
- total_score (numeric), intent (text), intent_keyword (text)
- language (enum: `en`, `pt`, `es`) — computed on import (see rules)
- status (enum: `pending`, `queued`, `sent`, `bounced`, `unsubscribed`, `failed`, `skipped`) default `pending`
- priority (numeric) — computed on import (see rules)
- created_at

**email_log**
- id, lead_id (fk), to_email, subject, language, resend_message_id, status, error, sent_at

**suppression** (do-not-contact / unsubscribes / hard bounces)
- id, email (unique), reason, created_at

**settings** (single row)
- daily_limit (int, default 50)
- send_start_hour, send_end_hour (business-hours window, default 9–17)
- timezone (default `America/Santiago`)
- per_domain_daily_cap (int, default 3) — never send more than N emails/day to the same recipient domain
- paused (bool, default false)

## CSV import
- Upload the leads CSV (columns include: First Name, Last Name, Email, Location, Job Title, Industry, Company, Company URL, Website, Intent, Total Score, Intent Keyword).
- On import, dedupe by email, skip anything already in `suppression`.
- **Language rule** from `Location`/country:
  - Brazil → `pt`
  - USA, Canada → `en`
  - Everything else (LATAM Spanish-speaking countries: Mexico, Argentina, Chile, Colombia, Peru, Uruguay, etc.) → `es`
- **Priority rule** (higher = send first): start from `total_score`; add +1.0 if intent contains "Strategic Window: Just hired"; add +0.8 if intent contains "Just engaged"; add +0.3 if intent contains "Top 5% most active". Sort the daily queue by priority desc.

## Email templates (store as editable records, one per language)
Personalize only by first name. Use a **neutral greeting** to avoid mis-gendering: `es` = "Hola {first_name}," / `pt` = "Olá {first_name}," / `en` = "Hi {first_name},". (Make greeting editable so the user can switch to Estimado/Prezado if they prefer.)

Subject (all languages): **Developers-As-A-Service**

Body sections (same structure in all three languages): intro paragraph → skills list → call-to-action paragraph → "Advantages" list → sign-off → HTML signature.

**Skills list (identical in all languages, keep tech names in English):**
- AI Engineering & LLMs: OpenAI, Anthropic Claude, LangChain/LangGraph, LlamaIndex, RAG, vector DBs (Pinecone, Weaviate, pgvector), fine-tuning, agentic workflows (MCP), prompt engineering
- AI/ML & Data Engineering: Python, PyTorch, TensorFlow, MLOps/LLMOps, Databricks, Apache Spark, dbt, Snowflake, BigQuery, Airflow
- Backend & APIs: Node.js, TypeScript, Go, Rust, Python (FastAPI, Django), Java (Spring Boot), GraphQL, microservices, event-driven architecture
- Cloud, DevOps & Platform: AWS, Azure, GCP, Kubernetes, Docker, Terraform, GitHub Actions, CI/CD, observability, SRE
- Frontend: React, Next.js, TypeScript, TailwindCSS, Vue, Svelte
- Mobile: React Native, Flutter, Swift/SwiftUI, Kotlin/Jetpack Compose
- QA, Security & Testing: Playwright, Cypress, Jest, DevSecOps, penetration testing

**English body:**
> I'm reaching out on behalf of Devups. We specialize in staffing developers and other IT professionals that you can renew month to month with no long-term commitment. Our recruiting and selection process has no cost or obligation, and all our talent has proven experience, ready to adapt to your specific needs.
> [skills list]
> If this is of interest, we can schedule a call or, if you prefer, you can tell me what type of profile you're looking for and your estimated monthly budget range. I'll gladly send you options with immediate availability for your review.
> **Advantages of working with DevUps:** 1-week free trial · Free cancellation with 15 days' notice · Option to hire the professional directly · Fast response time with no bureaucratic red tape
> I remain at your disposal for any questions or comments. Best regards,

**Spanish body:**
> Junto con saludarte, te contacto por parte de Devups. Nos especializamos en ofrecer un servicio de staffing de programadores y otros profesionales IT que puedes ir renovando mes a mes sin ataduras a largo plazo. Nuestro proceso de reclutamiento y selección no tiene costo ni compromiso, y todos nuestros talentos cuentan con experiencia comprobada, listos para adaptarse a tus necesidades específicas.
> [skills list]
> En caso de ser de su interés, podemos agendar una llamada o, si lo prefiere, puede comentarme qué tipo de perfil está buscando y el rango de presupuesto mensual estimado. Con gusto le enviaré opciones con disponibilidad inmediata para su revisión.
> **Ventajas de trabajar con DevUps:** 1 semana de prueba sin costo · Cancelación gratuita con 15 días de aviso · Posibilidad de contratación directa del profesional · Tiempo de respuesta rápido y sin procesos burocráticos
> Quedo atento a cualquier duda o comentario. Un cordial saludo,

**Portuguese body:**
> Entro em contato em nome da Devups. Somos especializados em oferecer um serviço de staffing de programadores e outros profissionais de TI que você pode renovar mês a mês, sem amarras de longo prazo. Nosso processo de recrutamento e seleção não tem custo nem compromisso, e todos os nossos talentos possuem experiência comprovada, prontos para se adaptar às suas necessidades específicas.
> [skills list]
> Caso seja do seu interesse, podemos agendar uma call ou, se preferir, você pode me dizer que tipo de perfil está buscando e a faixa de orçamento mensal estimada. Terei prazer em enviar opções com disponibilidade imediata para sua análise.
> **Vantagens de trabalhar com a DevUps:** 1 semana de teste sem custo · Cancelamento gratuito com 15 dias de aviso · Possibilidade de contratação direta do profissional · Tempo de resposta rápido e sem burocracia
> Fico à disposição para qualquer dúvida ou comentário. Atenciosamente,

**HTML signature** (append to every email — the user will paste the exact signature block; leave a settings field `signature_html` and inject it at the end of the body):
- Francisco Diesfeld — Customer Success — HR | Devups.io
- francisco.d@devups.io · +56981795753 · Alonso de Cordova 5870, OF 1601 · Devups.io
- Include the confidentiality footer text.

## Compliance (required)
- Append an **unsubscribe link** to every email footer ("If you'd prefer not to receive these, click here / si no deseas recibir estos correos, haz clic aquí"). Clicking adds the email to `suppression` and marks the lead `unsubscribed`. Public unsubscribe page, no login.
- Include a physical mailing address in the footer (Alonso de Cordova 5870, OF 1601).
- Never send to any email present in `suppression`.

## Sending logic (the daily job)
Create a Supabase scheduled Edge Function `send-daily-batch` that runs every weekday during the send window and:
1. If `settings.paused` is true, exit.
2. Count how many were already sent today; stop if `>= daily_limit`.
3. Select the next `pending` leads ordered by `priority` desc, excluding suppressed emails and respecting `per_domain_daily_cap`.
4. For each, render the template in the lead's language, inject signature + unsubscribe link, build the MIME message, and send via the Gmail API (`users.messages.send`). Write the returned message id to `email_log`. Mark lead `sent`.
5. **Bounce detection:** a separate scheduled function polls Gmail (`gmail.readonly`, search `from:mailer-daemon OR subject:"Delivery Status Notification"` newer_than:2d), parses the failed recipient address, moves it to `suppression`, and marks the lead `bounced`.
6. Add a small random delay (30–90s) between sends to avoid bursts. Respect Gmail's daily sending limit (Workspace ≈ 2,000 external/day) — `daily_limit` of 50 is well within it.

## Dashboard
- Cards: sent today / daily limit, total pending, total sent, bounces, unsubscribes.
- Table of leads with filters (status, language, priority) and a "Preview email" action that renders the exact email a given lead would receive.
- Buttons: Pause / Resume sending, Import CSV, Send test to my own address.
- Simple line chart of emails sent per day.

## MCP server (key requirement)
Expose a **remote MCP server** as a Supabase Edge Function at `/functions/v1/mcp`, implementing the Model Context Protocol over HTTP+SSE (JSON-RPC 2.0, standard `initialize` / `tools/list` / `tools/call` handshake). Protect it with a bearer token stored as a Supabase secret (`MCP_TOKEN`). Implement these tools:
- `get_stats()` → sent today, remaining, pending count, bounces, unsubscribes.
- `list_pending_leads(limit)` → next N leads by priority (id, name, email, company, language, priority).
- `preview_email(lead_id)` → the fully rendered subject + HTML for that lead.
- `create_todays_batch(limit=50)` → select and mark the next N leads as `queued`, return the list (does NOT send).
- `send_batch(limit=50)` → send to currently `queued` (or next N pending) leads now, return per-lead result.
- `pause()` / `resume()` → toggle `settings.paused`.
- `add_suppression(email, reason)` → add an address to the do-not-contact list.
- `import_leads(csv_url or rows)` → bulk insert with the language/priority/dedup rules above.

Return clear JSON from every tool. Document the MCP URL and how to set the `MCP_TOKEN` in the final README.

## Deliverability guardrails (build in, don't skip)
- Hard cap at `daily_limit` per day and `per_domain_daily_cap` per recipient domain per day.
- Randomized inter-send delay.
- Automatic suppression on bounce/complaint.
- Never re-send to a lead already `sent`.

Start by scaffolding the data model, CSV import, template rendering, and the dashboard. Then add the Resend sending function and the daily cron. Add the MCP server last.

---

## Cómo conectarlo a Claude (después de que Lovable lo despliegue)
1. En Lovable/Supabase, poné un valor secreto en `MCP_TOKEN`.
2. Copiá la URL del MCP: `https://<tu-proyecto>.supabase.co/functions/v1/mcp`.
3. En Claude → Settings → Connectors → **Add custom connector**, pegá esa URL y el token como bearer auth.
4. Avisame cuando esté conectado y yo pruebo `get_stats` y `preview_email` para validar que responde bien antes de mandar nada.

## Plan A vs Plan B (redundancia a propósito)
- **Plan A (yo al mando):** yo llamo `create_todays_batch` → `preview_email` para revisar → `send_batch`. Control total, revisás conmigo antes de cada tanda.
- **Plan B (autónomo):** el cron `send-daily-batch` manda 50/día solo, sin depender del MCP. Si el MCP de Lovable da problemas, esto igual funciona.

## Antes de enviar en frío — checklist de entregabilidad
- No necesitás verificar dominio ni tocar DNS: al enviar por la API de Gmail, Google firma con tu DKIM y tu DMARC en `p=reject` queda satisfecho automáticamente.
- Autorizá el scope `gmail.send` una sola vez con la cuenta `francisco.d@devups.io`.
- Respetá el límite diario de Gmail (Workspace ≈ 2.000 externos/día); 50/día está muy por debajo.
- Aun así, la reputación de tu cuenta/dominio SÍ se puede dañar con volumen frío. Empezá bajo (20–30/día la primera semana) y subí gradual — warmup.
- Revisá Google Postmaster Tools (postmaster.google.com) para vigilar tu tasa de spam real.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Módulo de Sourcing (Gojiberry + Apollo + Anymail Finder)

> Pegá esto en el MISMO proyecto de Lovable donde ya tenés el outreach engine. Extiende la app; no la reemplaza. Reutiliza la tabla `leads` existente y sus reglas de idioma/prioridad/dedup/supresión.

---

Extend the existing DevUps Outreach Engine with a **Sourcing module** that pulls prospects from two signal sources (Gojiberry + Apollo), finds a VERIFIED email for each via Anymail Finder, and inserts them into the existing `leads` table so the daily send picks them up. Reuse the existing `leads` schema, language rule, priority rule, dedup and suppression. **The only email layer is Anymail Finder** (it finds AND verifies, and only bills for verified emails) — do NOT add other enrichers or a separate verifier.

## Integrations (store keys as Supabase secrets)
1. **Gojiberry** (`GOJIBERRY_API_KEY`) — intent radar. Pull contacts by intent (recently changed job, recent activity, keyword, lookalike). Gojiberry gives name, company, jobTitle, LinkedIn URL, location, intent, score — but often **no email**. Use it as the "who to contact now" source.
2. **Apollo** (`APOLLO_API_KEY`) — ICP database + hiring signals. People/company search by ICP (titles, industry, country, size) and **job postings** (companies hiring engineers). Returns name, company, domain, LinkedIn, title. Apollo may return an email; still send it through Anymail for verification.
3. **Anymail Finder** (`ANYMAILFINDER_API_KEY`) — the ONLY email layer. For each prospect, call Anymail's REST API with LinkedIn URL (or name + company domain) to get a **verified** email. Accept only results marked `valid`. "Risky"/"not found" are free and are skipped. This keeps bounce < 2% and cost = only verified emails.

## New data model (Postgres)
**sourced_prospects**
- id, source (enum: `gojiberry`, `apollo`), external_id, first_name, last_name, full_name
- company, domain, job_title, seniority, location, country, linkedin_url
- intent (text), intent_type (text), score (numeric)
- email (text, null until verified), email_status (enum: `pending`, `valid`, `risky`, `not_found`)
- status (enum: `new`, `enriching`, `verified`, `imported`, `skipped`)
- created_at, updated_at

**enrichment_log**
- id, prospect_id (fk), provider ("anymailfinder"), input_type ("linkedin"|"name_domain"), result_status, email_found (bool), billed (bool), created_at

**sourcing_runs**
- id, started_at, finished_at, source, pulled, verified, imported, skipped_no_email, skipped_duplicate, credits_used, errors (jsonb)

## ICP config (settings, editable in dashboard)
- target_countries (default: US, Canada, Brazil, Mexico, Argentina, Colombia, Chile, Uruguay, Peru)
- target_industries (default: Software Development, SaaS, IT Services, Financial Services, Technology)
- target_titles (default: "VP of Engineering", "CTO", "Head of Engineering", "Director of Engineering", "VP of Software Engineering")
- company_size_range (default: 51–1000)
- min_open_eng_roles (default: 3)  // for Apollo job-posting signal
- daily_sourcing_limit (default: 100 new leads/day)
- anymail_monthly_cap (default: 5000)  // safety cap on verified-email spend

## Sourcing pipeline (Edge Function `run-sourcing`, param: source)
1. Pull prospects from the chosen source (Gojiberry by intent, or Apollo by ICP/job-postings). Upsert into `sourced_prospects` with status `new`. Skip anyone already in `leads` or `suppression` (dedup by LinkedIn URL and by name+company).
2. For each `new` prospect, call **Anymail Finder** (LinkedIn URL first; fall back to name + company domain). Log to `enrichment_log`.
   - If `valid` → save email, status `verified`.
   - If `risky`/`not_found` → status `skipped` (free, no charge).
3. Map each `verified` prospect to the existing `leads` schema and INSERT via the app's current dedup/language/priority logic. Set `intent` from the source (e.g. "Recently changed job", "Hiring: N open eng roles") and boost priority for strong signals. Mark `imported`.
4. Respect `daily_sourcing_limit` and `anymail_monthly_cap`. Stop and report if either is hit.
5. Write a `sourcing_runs` summary.

## Daily automation
Scheduled Edge Function `source-daily` (pg_cron, weekday mornings, BEFORE the send job): run `run-sourcing` for Gojiberry, then Apollo, up to `daily_sourcing_limit`, so each day's outreach batch has fresh verified leads.

## Dashboard (add to existing app)
- Cards: prospects pulled (7d), verified emails found, verification rate, Anymail credits used this month (vs cap), new leads added today.
- Table of sourced prospects with source, intent, email status, and a "Preview email" link (reuses existing preview).
- Sourcing config form (ICP settings above) + per-source enable/disable + pause toggle.

## MCP tools (add to the existing `/mcp` server, same path-token auth)
- `run_sourcing(source, limit)` → trigger a run now, return summary.
- `get_sourcing_stats()` → pulled/verified/imported/credits.
- `list_sourced_prospects(limit, status)` → recent prospects.

## Guardrails & compliance (build in)
- Only accept Anymail `valid` emails; never import `risky`/`not_found`.
- Cap Anymail spend with `anymail_monthly_cap`; stop and alert if hit.
- Dedup against existing `leads`; never re-contact `unsubscribed`/`bounced`; respect `suppression`.
- Store the source + signal per lead (consent trail) for CAN-SPAM/GDPR hygiene.

## Optional — Fase 3 (más adelante)
Add **TheirStack** (`THEIRSTACK_API_KEY`) as a third signal source: detect companies with >= `min_open_eng_roles` open engineering roles, resolve the decision-maker via Apollo, verify via Anymail. Same pipeline, new source value `theirstack`.

Build order: data model → Anymail Finder integration (test on a few LinkedIn URLs) → Gojiberry pull → Apollo pull → insert into `leads` → dashboard → daily cron → MCP tools.

---

## Keys que vas a necesitar (secrets)
`GOJIBERRY_API_KEY` (ya la tenés), `APOLLO_API_KEY`, `ANYMAILFINDER_API_KEY`. (TheirStack solo si hacés la Fase 3.)

## Primer movimiento de mayor ROI
Antes de traer leads nuevos, corré el pipeline sobre los **contactos de alta intención que Gojiberry ya tiene sin email** (recién cambió de trabajo + actividad reciente, ~228): pasalos por Anymail por su LinkedIn URL → los que verifiquen, directo a la campaña. Rescatás leads que ya pagaste sin gastar en fuentes nuevas.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Personalización del Primer Toque con la Señal

> Mejora el correo en frío: en vez de una plantilla genérica, cada primer toque **cita el disparador específico del lead** (está contratando, tech stack, ronda, actividad reciente). Es la palanca #1 de tasa de respuesta. Pegalo en el proyecto del motor.

---

## Qué hace
El **Copywriter** arma cada primer correo como: **apertura personalizada** (generada de la señal real del lead) + el cuerpo/plantilla existente. Opcional: un **P.S. personalizado**.

Ejemplos de apertura según la señal:
- Vacantes (TheirStack/Apollo): "Vi que están sumando 3 ingenieros de backend en {empresa}…"
- Just hired / cambió de rol: "Felicitaciones por el nuevo rol como {cargo}…"
- Actividad/engagement: "Me llamó la atención tu post sobre {tema}…"
- Ronda/crecimiento: "Vi que {empresa} cerró ronda hace poco…"

## Datos que usa (ya los tenés)
`leads.intent`, `intent_keyword`, `company`, `job_title`, `job_signals` (vacantes), tech stack, `total_score`. Del sourcing y de la memoria.

## Lógica
1. Elegir la **señal más fuerte** disponible para ese lead.
2. Generar 1–2 líneas de apertura ancladas en esa señal (LLM, en el idioma del lead, en la voz del remitente).
3. Inyectar antes del cuerpo estándar. Mantener 1 solo CTA y pocos links (deliverability).
4. **Fallback:** si no hay señal fuerte, usar apertura genérica (no inventar).

## Guardrails
- **Solo citar señales reales y verificables** (nada inventado). Marcar confianza; si es dudosa, no personalizar.
- No sonar "stalker": referencia profesional y pública, no datos privados.
- Listo para **A/B**: variante personalizada vs. control genérico (ver módulo de Analytics).

## Data model
Reusa `leads` + `job_signals`. Guardar `leads.personalized_opener` (cache) y `opener_source` (qué señal se usó) para auditar y medir.

Build order: selector de señal más fuerte → generador de apertura (LLM, idioma+voz) → inyección en el template → preview → flag de A/B personalizada vs genérica.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Deliverability a Escala (dominios, buzones, warmup)

> Para escalar volumen frío sin quemar tu dominio principal. El Guardián de Entregabilidad gestiona rotación, warmup y salud por buzón. Pegalo en el proyecto del motor.

---

## Estrategia
- **Protegé `devups.io`** (el dominio principal) para correos cálidos y respuestas.
- Usá **dominios secundarios** para el frío (ej. `getdevups.com`, `devups-hire.com`), cada uno con su SPF/DKIM/DMARC bien configurados.
- **Varios buzones por dominio**, cada uno con **límite bajo** (30–50/día) y **warmup** gradual antes de escalar.
- **Rotación**: el envío reparte entre buzones sanos; nunca cargar todo en uno.

## Warmup
Rampa automática por buzón nuevo (ej. 10 → 20 → 35 → 50/día en ~2–3 semanas), idealmente con tráfico de calentamiento (respuestas simuladas / red de warmup). Un buzón no entra a producción hasta completar warmup.

## Monitoreo (el Guardián)
- Salud por **buzón y por dominio**: rebotes, quejas, tasa de spam.
- **Placement/seed tests** periódicos (inbox vs spam) con cuentas semilla.
- **Monitoreo DMARC** (reportes agregados).
- Si un buzón/dominio se degrada → **pausar y sacar de la rotación** automáticamente, alertar al Concierge.

## Data model
**domains** — id, name, purpose (`primary`/`cold`), dns_status (spf/dkim/dmarc), reputation, active.
**mailboxes** (extender) — domain_id, warmup_stage, daily_cap, health_score, status (`warming`/`active`/`paused`).
**placement_tests** — id, mailbox_id, inbox_rate, spam_rate, tested_at.

## Guardrails
- Nunca exceder el cap por buzón ni el tope por dominio recipiente.
- Aislar reputación: el frío no toca el dominio principal.
- Warmup obligatorio antes de producción.

Build order: alta de dominios secundarios + chequeo DNS → buzones con warmup_stage/caps → rotación en el Agente de Envío → salud por buzón/dominio + auto-pausa → seed/placement tests → monitoreo DMARC.

## Fuera de la app (setup)
Comprar dominios secundarios, configurar DNS (SPF/DKIM/DMARC), crear los buzones (Google Workspace u otro) y conectarlos. La app gestiona warmup, rotación y salud.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Registro de Contactados + Guardia Anti-reenvío (escaneo continuo de buzones)

> Pegá esto en el MISMO proyecto de Lovable. Escanea de forma continua **todos** los buzones conectados (enviados y recibidos) para saber a quién ya se contactó —aunque haya sido a mano, por fuera del sistema o desde otro buzón del equipo— y **bloquea el reenvío** antes de mandar.

---

## Problema que resuelve
El motor ya evita reenviar a quien **él** contactó. Pero no ve: correos enviados **manualmente**, por **otro miembro**, o histórico previo. Resultado: riesgo de mandarle un frío a alguien con quien ya hablaste. Esto lo cierra.

## Escaneo continuo (todos los buzones)
- **Backfill inicial:** al conectar cada buzón, escanear el histórico de **Enviados + Recibidos** (Gmail `gmail.readonly`) y poblar el registro.
- **Continuo:** un job incremental cada ~15 min (reusa el poller de detección de respuestas) actualiza el registro con cada nuevo enviado/recibido, por cada buzón del equipo.
- Extrae por cada dirección: primera y última vez contactada, canal, **qué buzón** la contactó, y el hilo.

## Registro (org-level)
**contacted_registry** — email (normalizado, único por org), first_contacted_at, last_contacted_at, last_channel, contacted_by_mailbox, thread_ref, source (`system`/`manual`/`reply`/`inbound`).
**scan_state** — mailbox_id, last_scanned_at, cursor.

> Normalización obligatoria: minúsculas, quitar espacios, y para Gmail colapsar `puntos`/`+alias`. Manejar alias/dominios equivalentes.

## Guardia pre-envío (bloqueante)
Antes de **cualquier** envío (tanda del motor, follow-up, WhatsApp, o "enviar" manual desde el asistente):
1. Si el email está en **suppression** → **bloquear**.
2. Si está en **contacted_registry** dentro de la ventana de no-recontacto → **saltar** y marcar el motivo (ya contactado, por quién, cuándo).
3. **Excepciones:** continuar el **mismo hilo** (es conversación en curso) o un **override explícito** aprobado por el owner están permitidos.
- Regla configurable: p.ej. "nunca recontactar en frío a quien ya recibió un correo nuestro" o "no recontactar si hubo contacto en los últimos N meses".

## Anti-colisión de equipo
Como el registro es **org-level**, evita que dos miembros contacten a la misma persona. (El registro guarda solo el flag + metadata mínima; el **contenido** de los mensajes sigue protegido por RLS.)

## Integración con los agentes
- El **Agente de Envío** y el de **Follow-up** consultan la guardia **antes** de cada envío.
- El **Guardián de Compliance** es dueño de la regla; puede endurecerla o auditarla.
- Al importar leads (Sourcing), pre-marcar los que ya están en el registro.

## MCP tools
- `check_contacted(email)` → estado + cuándo/quién.
- `get_contacted_registry(filters)`, `set_recontact_rule(config)`, `override_recontact(email, reason)`.

## Guardrails
- Bloqueo **antes** de enviar, no después.
- Todo override queda **auditado** (quién y por qué).
- Escaneo solo de metadata de contacto para el registro; el contenido va por la memoria con RLS.

Build order: backfill de enviados/recibidos por buzón → `contacted_registry` normalizado → job incremental continuo → guardia pre-envío bloqueante en Envío/Follow-up/WhatsApp → regla de ventana configurable + overrides auditados → pre-marcado en la importación de leads.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Módulo de Respuestas y Calificación (Reply & Qualification)

> Pegá esto en el MISMO proyecto de Lovable. Convierte el motor de envío en un motor de cierre: detecta respuestas, las clasifica con IA, les asigna probabilidad de cierre, las rutea y corre cadencias de follow-up. Reutiliza `leads`, `suppression` y el acceso a Gmail que ya existen.

---

Extend the DevUps Outreach Engine with a **Reply & Qualification module**. It detects inbound replies, classifies them with AI, assigns a close probability, moves the lead through a pipeline, routes each reply to the right action, and runs follow-up cadences for non-repliers. Human-in-the-loop for anything hot.

## New data model (Postgres)
**replies**
- id, lead_id (fk), thread_id, gmail_message_id, received_at, from_email, body_text
- category (enum: `interested`, `question`, `referral`, `later`, `not_interested`, `unsubscribe`, `ooo`, `auto_reply`, `other`)
- sentiment (enum: `positive`, `neutral`, `negative`)
- close_probability (int 0–100)
- reasoning (text), suggested_action (text), draft_reply (text, in lead's language)
- status (enum: `new`, `routed`, `handled`), handled_by, handled_at

**follow_ups**
- id, lead_id (fk), step (int), scheduled_at, sent_at, template, status (enum: `scheduled`, `sent`, `skipped`, `stopped`)

Add to **leads**: `stage` (enum: `new`, `contacted`, `replied`, `qualified`, `meeting`, `won`, `lost`) and `close_probability` (int 0–100).

## Reply detection (Edge Function `detect-replies`, scheduled every ~30 min)
- Poll Gmail (`gmail.readonly`) for new INBOUND messages on threads where we sent (match by thread / In-Reply-To).
- For each new inbound message not yet in `replies`: create a `replies` row, set lead `stage = replied`, and **STOP that lead's follow-up cadence**.
- Ignore our own sent messages; dedup by `gmail_message_id`.

## AI classification (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
For each new reply, call the LLM with: the reply body + the original email + lead context (title, company, intent/score). Ask it to return JSON:
- `category`, `sentiment`, `close_probability` (0–100, calibrated), `reasoning` (1 line), `suggested_action`, and `draft_reply` (in the lead's language, only when a reply makes sense).

**Close-probability guide (base by category, then adjust):** interested ~75, question ~50, referral ~35, later ~30, not_interested ~2, unsubscribe 0. Adjust up for explicit buying language (asks pricing, availability, timelines, team size) and for strong original intent (hiring signal / just hired); adjust down for vague or negative tone.

## Routing logic (per category)
- **interested / high prob** → set `stage = qualified`, create a task + notify the user, **PAUSE automation for this lead**, surface the `draft_reply` for approval. Human takes over.
- **question** → generate a `draft_reply` answering it; hold for user approval (do NOT auto-send unless the `auto_reply_enabled` setting is on).
- **later** → parse the timeframe ("next quarter", "in 2 months") and **schedule a follow-up** at that date; keep in nurture.
- **referral** → extract the referred name/email if present, create a NEW lead (dedup), and draft a thank-you.
- **not_interested** → set `stage = lost`, add to `suppression`, stop.
- **unsubscribe** → add to `suppression`, stop immediately.
- **ooo / auto_reply** → do NOT count as a real reply; reschedule the next follow-up after the return date; keep cadence running.

## Follow-up cadence (for non-repliers)
- Configurable steps; default: **+3 días (bump breve) → +7 días (aporte de valor: caso/skill relevante) → +14 días (cierre/breakup)**.
- Runs from the daily scheduled job. Each step uses a template in the lead's language (EN/PT/ES) and replies within the original thread.
- **Stop conditions:** any reply, unsubscribe, bounce, or reaching max touches. Never follow up someone in `suppression`.

## Dashboard (add to existing app)
- **Pipeline board** (kanban): New → Contacted → Replied → Qualified → Meeting → Won/Lost, each card showing close probability.
- **Replies inbox**: category, close probability, suggested action, and the AI draft, with Approve/Edit/Send and "Mark handled".
- **Follow-up queue**: upcoming cadence steps, with pause/skip.
- **Metrics**: reply rate, positive-reply rate, meetings booked, avg close probability, cadence performance.

## MCP tools (add to `/mcp`, same path-token auth)
- `get_pipeline_stats()` → counts per stage + avg close probability.
- `list_replies(status)` → recent replies with category/probability/draft.
- `classify_reply(id)` → re-run classification.
- `set_stage(lead_id, stage)` / `schedule_followup(lead_id, when)`.

## Guardrails
- **Human-in-the-loop for hot leads:** never auto-send to `interested`/`qualified` without approval.
- Auto-replies OFF by default (toggle `auto_reply_enabled`).
- Respect `suppression` and unsubscribe always; stop cadence on any reply.
- Log AI classification + probability so decisions are auditable.

## Keys
Reuse Gmail (`gmail.readonly` — ya sugerido para rebotes). Add `OPENAI_API_KEY` **o** `ANTHROPIC_API_KEY` para la clasificación.

Build order: leads.stage + replies/follow_ups tables → reply detection → AI classification → routing → follow-up cadence → dashboard (pipeline + replies inbox) → MCP tools.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Redactor IA con Voz y Contexto (auto-draft estilo Kinso)

> Pegá esto en el MISMO proyecto de Lovable. Mejora el auto-borrador del módulo de respuestas: que cada borrador **suene a la persona que responde** (su voz y tono) y esté **redactado con contexto** (el hilo, el historial del lead y las reuniones recientes). Sigue siendo human-in-the-loop: el borrador se aprueba antes de enviar.

---

## Qué hace
Cuando llega una respuesta (o hay que hacer un follow-up), el sistema redacta un borrador que:
1. **Suena a la voz del dueño del lead** (cada miembro tiene su estilo aprendido).
2. Está **fundado en contexto**: todo el hilo, el historial del lead en el CRM, y notas de reuniones/discusiones relevantes.
3. Va en el **idioma del lead** (EN/PT/ES).
El borrador se muestra para aprobar/editar/enviar (en el dashboard o vía el agente de WhatsApp).

## Perfiles de voz (aprender el estilo)
- **Por miembro:** construir un `voice_profile` a partir de sus correos ENVIADOS (Gmail `gmail.readonly`): tono, formalidad, largo de frases, saludos y despedidas típicos, muletillas y frases recurrentes. Guardar como resumen estructurado + varios *snippets reales* de ejemplo (few-shot).
- **Por relación (opcional, el ángulo "distintas personas"):** aprender que la persona escribe distinto a un CTO que a un peer; ajustar formalidad según el destinatario.
- **Refresco:** recalcular el perfil periódicamente con los envíos nuevos.

## Ensamblado de contexto (RAG)
Para cada borrador, armar el prompt con:
- El **hilo completo** con ese lead (ida y vuelta).
- **Contexto del CRM:** intent, score, etapa del pipeline, empresa, toques previos.
- **Reuniones / discusiones recientes** relevantes (opcional, si se conecta Google Calendar / notas de reunión / el grupo de WhatsApp del equipo).
- La categoría y probabilidad de cierre que ya calculó el clasificador.

## Generación del borrador
- El LLM (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) redacta en la **voz del miembro** + **idioma del lead**, fundado en el contexto. Devuelve: `draft`, `confidence`, y `context_used` (qué usó, para transparencia).
- **Nunca auto-envía leads calientes** — el borrador es sugerencia; se aprueba.

## Loop de aprendizaje (clave)
- Cuando el usuario **edita** el borrador antes de enviar, capturar el diff (borrador original → enviado final) y **actualizar el `voice_profile`**. Así el sistema aprende de verdad cómo comunica cada uno y mejora con el uso.

## Data model
**voice_profiles** — id, user_id, tone_summary, style_rules (jsonb), example_snippets (text[]), per_relationship (jsonb, opcional), updated_at.
**draft_feedback** — id, reply_id, user_id, draft_original, sent_final, edit_diff, created_at.
Reusar `replies.draft_reply` y `replies.close_probability` del módulo de respuestas.

## Integraciones
- **Aprendizaje de estilo:** leer la carpeta de Enviados del miembro (Gmail `gmail.readonly`) para construir/actualizar el perfil.
- **Contexto de reuniones (opcional):** Google Calendar / un MCP de notas de reunión.
- LLM para redacción y para resumir el estilo.

## Dashboard
- En cada respuesta: el borrador con un badge "en la voz de {miembro}", editor inline, botones Aprobar / Editar / Enviar, y un desplegable "contexto usado".
- Sección "Mi voz": ver/ajustar el perfil de estilo, con ejemplos, y un toggle para regenerarlo desde los envíos.

## Guardrails
- Aprobación humana para todo lo caliente; los borradores son sugerencias, no envíos.
- Un perfil de voz por miembro — no mezclar voces entre personas.
- Respetar idioma y supresión.
- Guardar `context_used` para que cada borrador sea auditable.

Build order: voice_profiles desde correos enviados → ensamblado de contexto (hilo + CRM) → generación de borrador en voz + idioma → mostrar/aprobar en dashboard y WhatsApp → loop de aprendizaje con las ediciones → (opcional) contexto de reuniones.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Tablero de Pipeline y Funnels (Kanban)

> Pegá esto en el MISMO proyecto de Lovable. Es la UI visual del pipeline: un tablero kanban con tarjetas de leads, y la posibilidad de tener **varios funnels configurables** (cada uno con sus etapas, reglas y fuente).

---

## Qué hace
- **Tablero kanban** del pipeline: columnas = etapas, tarjetas = leads. Arrastrás una tarjeta entre etapas y se actualiza el estado (y puede disparar acciones).
- **Múltiples funnels:** funnels con nombre (p.ej. "Web chat inbound", "Outbound frío", "Referidos"), cada uno con sus etapas, su fuente y sus reglas. Cada funnel tiene toggle **Activo** y botón **Probar** (correr un lead de prueba por el flujo).

## Tablero (board)
- **Columnas configurables** (default: Nuevo → Contactado → Interesado → Calificado → Reunión → Ganado / Perdido), con contador por columna.
- **Tarjeta de lead:** nombre, última actividad ("hace 3 horas"), email, **tags** (industria, volumen/presupuesto, fuente), probabilidad de cierre y avatar del dueño. SLA visible si aplica ("Será contactado en 21 h").
- **Drag & drop** entre etapas → actualiza `leads.stage` y dispara triggers de transición (ej.: mover a "Reunión" crea un hold en calendario; a "Ganado" marca won).
- **Detalle de tarjeta:** drawer con el timeline unificado del contacto (usa el módulo de memoria) y acciones rápidas.

## Funnels (múltiples pipelines)
- Cada funnel define: `name`, `source_type` (outbound / web chat / referidos / import), **etapas** (orden y nombres), **reglas** (qué cadencia y templates aplican, triggers de entrada/salida de etapa, SLA), y estado **Activo/Inactivo**.
- **Probar:** enviar un lead ficticio por el funnel para ver el comportamiento sin tocar leads reales.
- Un lead pertenece a un funnel (`leads.funnel_id`) y puede moverse entre funnels.

## Filtros
Por rango de tiempo ("Esta semana"), dueño, tag, fuente, funnel y búsqueda.

## Data model
**funnels** — id, org_id, name, source_type, stages (jsonb ordenado), active (bool), rules (jsonb), created_at.
**lead_tags** — id, lead_id, key (industria/volumen/presupuesto/…), value.
Add `funnel_id` a `leads`. El board es una query que agrupa `leads` por `stage` dentro de un funnel.

## Integración
- Reusa `leads.stage`, `close_probability`, `replies`, cadencia y el timeline (memoria).
- El **módulo de respuestas** mueve etapas automáticamente (respondió → Respondió/Calificado); el tablero es la capa visual y manual encima.

## Permisos
RLS: cada miembro ve sus leads/funnels (+ lo habilitado); owner/admin ve todo.

## MCP tools (mismo `/mcp`)
- `list_funnels()`, `get_board(funnel_id, filters)`, `move_lead(lead_id, stage)`, `create_funnel(config)`, `set_funnel_active(id, bool)`.

## Guardrails
- Todo movimiento de etapa se **audita**.
- Automatizaciones de transición **configurables y explícitas** (no sorpresas).
- Filtrado por RLS.

Build order: funnels + leads.funnel_id + tags → board kanban con conteos → drag & drop + update de stage → triggers de transición → múltiples funnels + Activo + Probar → filtros → drawer con timeline → tools MCP.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Calendario y Agendamiento Automático

> Pegá esto en el MISMO proyecto de Lovable. Conecta el calendario del equipo y cierra el ciclo: cuando un lead se interesa, el sistema propone horarios reales, reserva y crea la reunión — en el calendario del dueño correcto, con recordatorios.

---

## Qué hace
- Conecta el calendario de cada miembro (Google Calendar / Outlook).
- Cuando un lead quiere reunirse, **propone horarios reales** (según disponibilidad) o manda un **link de reserva**; cuando el lead elige, **crea la reunión automáticamente** con link de video (Google Meet) e invita a ambos.
- Reserva en el **calendario del dueño del lead** (respeta la asignación del equipo).
- Maneja zona horaria, recordatorios, reprogramaciones y no-shows.

## Integraciones
- **Google Calendar API** y **Microsoft Graph (Outlook)** — free/busy + crear eventos. OAuth por usuario (reusa el login de Google del equipo).
- **Video:** Google Meet (o Zoom) automático en el evento.
- LLM para parsear horarios en lenguaje natural ("el martes a la tarde").

## Disponibilidad y reglas
**availability_rules** por usuario: horario laboral, buffers entre reuniones, duraciones ofrecidas (15/30/45), aviso mínimo, días bloqueados, y **zona horaria** (mostrar en la del lead).

## Flujo de agendamiento
1. El lead muestra interés (respuesta clasificada como "interesado" o pide reunión).
2. El **redactor** inserta en la respuesta: horarios propuestos (de la disponibilidad real) **o** un link de reserva.
3. El lead elige → se **crea el evento** (con Meet), se invita a ambos, y el lead pasa a etapa **Reunión** en el pipeline.
4. **Round-robin / asignación:** si el lead no tiene dueño, se asigna y se reserva en su calendario.
5. **Confirmaciones y recordatorios:** por email y por el agente de WhatsApp (24h antes, 1h antes).
6. **Reprogramar / cancelar:** links en el evento; el sistema actualiza calendario y pipeline. Manejo de **no-show** (marca y reactiva follow-up).

## Data model
**calendar_connections** — user_id, provider (`google`/`outlook`), oauth tokens (secret ref), primary_calendar_id, timezone.
**meetings** — id, lead_id, owner_user_id, calendar_event_id, video_link, start, end, status (`scheduled`/`confirmed`/`rescheduled`/`canceled`/`no_show`), created_at.
**booking_links** — id, user_id, slug, meeting_type, duration_min, active.
Reusa `availability_rules`, `leads.stage`, `meeting_preps`.

## Conexiones con el resto del sistema
- **Routing:** "Interesado → al dueño + **agenda**" dispara la propuesta de horarios.
- **Pipeline:** al reservar, el lead pasa a **Reunión**.
- **Prep de reunión:** la reunión creada alimenta la tarjeta de prep (módulo 360).
- **Asistente / WhatsApp:** comandos "agendá con X el martes 3pm", "movéme la reunión de Y", "¿qué reuniones tengo hoy?".

## Permisos y guardrails
- RLS por miembro; reservar en el calendario de otro requiere permiso.
- **Nunca doble-bookear**; respetar buffers y aviso mínimo.
- Confirmar antes de reservar si la config lo pide (o auto según settings).
- Zona horaria correcta del lead siempre.

## Keys / setup
OAuth de Google Calendar / Microsoft Graph por usuario; scope de calendario. Reusa el LLM y las MCP tools.

Build order: conexión de calendario + free/busy → availability_rules → propuesta de horarios en la respuesta → auto-creación de evento + Meet + invite → round-robin + paso a etapa Reunión → recordatorios (email + WhatsApp) → reschedule/cancel/no-show → comandos por asistente/WhatsApp.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Integración de Talento (Supply) + Matching + Shortlist

> El pool de devs ya existe en OTRO sistema de Lovable. Esto NO lo reconstruye: lo **integra**, y agrega el **matching** (dev ↔ necesidad del cliente) y el **shortlist** que se manda tras la reunión. Pegalo en el proyecto del motor de outreach.

---

## Transporte: MCP (definido)
El sistema de talento expone un **MCP server**. El motor de outreach actúa como **cliente MCP** de ese servidor: desde una Edge Function llama al endpoint MCP del talento (con su token) para consultar los devs.
- **Tools esperadas del MCP de talento:** `list_devs`, `search_devs(filters)`, `get_dev(id)` (o equivalentes — hay que **inspeccionar el server real** para los nombres y campos exactos).
- Envolvé esas llamadas en un adaptador **`talent_source`** con interfaz estable (`search_devs`, `get_dev`), para que el matching no dependa de los nombres exactos de las tools.
- **Cache liviano** (`talent_cache`, TTL corto) para no pegarle al MCP en cada match; el sistema de talento sigue siendo la **fuente de verdad** (solo lectura desde el motor).
- **Siguiente paso recomendado:** conectá el MCP de talento como conector (igual que hicimos con el del motor) para inspeccionar sus tools/campos reales y afinar el matching contra la forma verdadera de los datos.

## Datos que se necesitan del sistema de talento (por dev)
nombre, seniority, **skills / tech stack**, disponibilidad (fecha), **rate mensual**, nivel de inglés, región/zona horaria, bio corta, links de trabajo (GitHub/portfolio), y estado (disponible / asignado).

## Captura de la necesidad del cliente
La **necesidad** se arma desde la conversación (el agente Triage/Research extrae requisitos de las respuestas del lead) o con un mini-form: rol, stack, seniority, presupuesto mensual, zona horaria, cantidad, urgencia, notas.

## Matching (dev ↔ necesidad)
Dado una `need`, rankear candidatos con **reglas + semántico**: match de stack/seniority (rules), cercanía de zona horaria, encaje de rate al presupuesto, disponibilidad; y similitud semántica entre la descripción de la necesidad y el perfil. Devolver top N con score y **razonamiento** ("React + Node senior, GMT-3, disponible ya, dentro de presupuesto").

## Shortlist
Ensamblar 3–5 perfiles matcheados en un **shortlist compartible** (link o PDF, con branding DevUps, sin exponer datos sensibles). El **Copywriter** lo incluye en la respuesta / follow-up post-reunión.

## Data model (lado motor)
**talent_cache** (si es API/MCP: espejo liviano de perfiles con TTL) — dev_id, nombre, stack, seniority, rate, tz, availability, updated_at.
**needs** — id, lead_id, role, stack (text[]), seniority, budget, timezone, qty, urgency, notes, created_at.
**matches** — id, need_id, dev_id, score, reasoning.
**shortlists** — id, need_id, dev_ids (int[]), url, sent (bool), created_at.

## Handoffs (cómo encaja en los agentes)
Triage/Research detecta una **necesidad** → **Matching** → **Shortlist** → **Copywriter** lo adjunta → **Envío/Agendador** lo manda antes/después de la reunión. El pipeline pasa a "Reunión" con el shortlist listo.

## Guardrails
- Nunca ofrecer un dev **no disponible** o fuera de presupuesto sin marcarlo.
- No exponer datos sensibles del dev en el shortlist público.
- Respetar RLS y la fuente de verdad del sistema de talento (no duplicar/editar allá; solo leer).

Build order: adaptador `talent_source` (cliente MCP del sistema de talento) → captura de `need` desde la conversación → matching (reglas + semántico) → shortlist compartible → inserción en la respuesta vía Copywriter.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Búsqueda Universal y Memoria (estilo Kinso)

> Pegá esto en el MISMO proyecto de Lovable. Suma una barra de búsqueda universal: preguntá en lenguaje natural sobre TODO lo que el equipo conversó (emails, WhatsApp, respuestas, notas), sin recordar las palabras exactas, y obtené una respuesta sintetizada con sus fuentes. Respeta los permisos del equipo (RLS).

---

## Qué hace
- **Buscar sin palabras exactas:** "¿qué le ofrecimos a Susan?" → devuelve un resumen ("Le ofreciste un descuento si aceptaba los términos antes de fin de mes") + la tarjeta del email/mensaje fuente.
- **Preguntar sobre cualquier contacto/deal:** "¿en qué quedamos con Figma?", "¿quién habló de precio esta semana?".
- **Resúmenes on-demand** por contacto o por deal.
Todo filtrado por lo que cada usuario tiene permitido ver.

## Arquitectura (RAG híbrido)
1. **Ingesta:** indexar cada hilo de email, respuesta, mensaje de WhatsApp y nota. Incremental, a medida que llegan mensajes nuevos.
2. **Índice doble:** full-text (keyword) + **embeddings** (semántico) en **pgvector** (Supabase). Cada chunk guarda metadata: lead, usuario dueño, canal, fecha, link a la fuente.
3. **Consulta:** la pregunta se embeddea → **retrieval híbrido** (semántico + keyword) → el LLM sintetiza la respuesta **citando las fuentes** (links al email/mensaje original).
4. **Permisos:** el retrieval se filtra por **RLS** — un miembro solo busca en lo que puede ver (lo suyo + lo que el owner le habilitó); owner/admin ve todo.

## Data model
**documents** — id, source_type (`email`/`whatsapp`/`reply`/`note`), source_id, lead_id, owner_user_id, org_id, content, metadata (jsonb), created_at.
**document_chunks** — id, document_id, content, embedding (vector), token_count.
**search_log** (opcional) — id, user_id, query, results_count, created_at.

## Integraciones
- Reusar los datos que el sistema ya guarda (emails/replies/WhatsApp/notas).
- **Embeddings:** API de OpenAI/Anthropic (u otro proveedor de embeddings) → `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`.
- pgvector en Supabase para el índice semántico.

## UI
- **Barra de búsqueda universal** arriba de la app: resultado = resumen IA + tarjetas de fuente (con ícono del canal y link).
- **Panel "Memoria" por lead:** resumen de todo el historial con ese contacto, en un vistazo.
- Búsqueda accesible también desde el **agente de WhatsApp** ("¿en qué quedamos con X?" por chat).

## MCP tools (mismo `/mcp`, path-token auth)
- `search_conversations(query)` → respuesta sintetizada + fuentes.
- `summarize_contact(lead_id)` → resumen del historial.
- `ask(query)` → Q&A general sobre las conversaciones del usuario.

## Guardrails
- **Retrieval siempre filtrado por RLS:** nunca mostrar datos fuera de los permisos del usuario.
- **Citar fuentes** en cada respuesta (auditable, evita alucinaciones).
- No exponer contenido de otros miembros sin grant explícito.

Build order: ingesta + document/chunks + pgvector → embeddings incrementales → retrieval híbrido con filtro RLS → síntesis con citas → barra de búsqueda + panel de memoria → tools MCP → acceso desde el agente de WhatsApp.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Conexión de Conversaciones y Contexto Proactivo (estilo Kinso)

> Pegá esto en el MISMO proyecto de Lovable. Es la evolución de la capa de memoria: no solo buscar cuando preguntás, sino **unir automáticamente lo que pertenece junto** (el mismo contacto a través de email, WhatsApp y Slack) y **anticipar el contexto** que vas a necesitar antes de que lo pidas.

---

## Qué hace
1. **Conecta conversaciones entre canales:** reconoce que el "Natasha del email", el de WhatsApp y el de Slack son la misma persona/deal, y arma un **timeline único**. Relaciona ítems dispersos: "contrato enviado por WhatsApp" ↔ "email que lo pedía"; "detalles de reunión en Slack" ↔ "hilo de email".
2. **Contexto proactivo:** cuando entra un mensaje ("¿tenés un price guide?"), detecta el pedido y **trae solo el asset/mensaje relevante** ("acá está el price guide que ya le mandaste a un cliente") — antes de que preguntes. Alimenta al **redactor** (para que el borrador incluya el link/adjunto correcto) y al **agente de WhatsApp** (que lo notifica).

## Capacidad A — Resolución de identidad + timeline
- **Identity resolution:** unir por email, teléfono, handle, nombre y dominio. Un `contact` unificado con múltiples `contact_identities` (una por canal).
- **Timeline unificado por contacto/deal:** todos los toques (emails, WhatsApp, Slack, notas, reuniones, assets) en una sola vista cronológica.
- **Inferencia de vínculos:** relacionar ítems por entidad compartida + similitud semántica (embeddings) + proximidad temporal; guardar con un score de confianza.

## Capacidad B — Contexto proactivo
- En cada mensaje entrante: detectar intención/pedido → **retrieval del asset o mensaje que corresponde** desde la memoria (price guide, contrato, deck, propuesta previa).
- **Surface** del resultado en: el composer de respuesta (sidebar de contexto), el agente de WhatsApp, y el inbox unificado. **Sugerido, no auto-enviado.**

## Data model
**contacts** (unificado) + **contact_identities** — id, contact_id, channel, identifier (email/phone/handle).
**conversation_links** — id, item_a, item_b, relation, confidence, created_at.
**assets** — id, type (`price_guide`/`contract`/`deck`/`doc`/`link`), title, url/file_ref, sent_to (lead_id[]), embedding, created_at.
**proactive_suggestions** — id, trigger_message_id, suggestion_type, asset_id/source_id, reasoning, shown (bool), used (bool), created_at.

## Integraciones
- Reusar la memoria/embeddings (pgvector) y los datos de email/WhatsApp/replies.
- **Slack (opcional):** conectar en modo lectura para sumar el contexto de discusiones internas.
- **Assets:** indexar adjuntos/links que ya enviaste (Gmail attachments, Drive/Docs) para poder re-surface-arlos.

## UI
- **Timeline unificado** por contacto: todos los canales en una vista.
- **Sidebar de contexto** en el composer: aparece solo el asset/mensaje relacionado, con "usar / insertar link".
- El **agente de WhatsApp** incluye el contexto en su aviso ("Natasha pide precios — le mandaste este price guide acá").

## MCP tools (mismo `/mcp`)
- `get_contact_timeline(contact_id)` → todo el historial cross-canal.
- `find_related(message_id)` → ítems/assets relacionados.
- `suggest_context(reply_id)` → asset/mensaje a surface-ar.

## Guardrails
- Retrieval y linking **filtrados por RLS** (nada fuera de los permisos del usuario).
- Vínculos con score de confianza; los de baja confianza se marcan, no se afirman.
- Las sugerencias se **muestran**, no se envían solas.
- Citar/linkear siempre la fuente.

Build order: identity resolution + contacts/identities → conversation_links (entidad + semántico + temporal) → timeline unificado → assets index → contexto proactivo en el composer → surface en WhatsApp → (opcional) Slack como fuente.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Perfil de Contacto 360 y Prep de Reunión (estilo Kinso)

> Pegá esto en el MISMO proyecto de Lovable. Es la cara de contacto que se para sobre la memoria unificada: una ficha rica por persona con toda tu historia cross-canal, una bio generada, los datos clave, y **preparación automática antes de cada reunión**.

---

## Qué hace
- **Perfil 360 por contacto:** foto, nombre, rol, empresa, ubicación, y **en qué canales hablaron** (Gmail, WhatsApp, LinkedIn, Slack, Instagram, Outlook). Una **bio generada** de quién es, tu **historia resumida** con esa persona, y los **datos clave** que conviene recordar.
- **Prep de reunión:** ¿tenés una reunión con alguien? El sistema resalta lo más importante que hablaste con esa persona para que entres preparado.

## Perfil del contacto
- **Header:** foto, nombre, rol · empresa · ubicación, e íconos de los canales donde existe la conversación.
- **Bio IA:** resumen corto de quién es (enrichment + info pública + tu historial). Grounded, sin inventar.
- **Resumen de la relación:** tu historia con la persona a través de todos los canales, sintetizada.
- **Datos clave / memoria:** compromisos hechos, preferencias, temas abiertos, fechas importantes — extraídos y mantenidos al día.
- **Timeline:** la historia completa cross-canal (del módulo de memoria).

## Prep de reunión
- **Vigila Google Calendar.** Antes de una reunión con un contacto conocido, genera una **tarjeta de prep**: los detalles recientes más importantes, compromisos abiertos, últimas interacciones y puntos sugeridos para hablar.
- **Entrega:** en el briefing diario, por el agente de WhatsApp, y en el asistente ("prepárame para la reunión con X").

## Data model
**contact_profiles** — contact_id, bio, relationship_summary, key_facts (jsonb), channels (text[]), updated_at.
**meeting_preps** — id, contact_id, calendar_event_id, prep_summary, created_at.
Reusa `contacts`, `contact_identities`, el timeline y la memoria (embeddings).

## Integraciones
- **Memoria / timeline** (ya construida) como fuente de la historia.
- **Enrichment** (Apollo / Anymail) para rol, empresa y datos firmográficos de la bio.
- **Google Calendar** para detectar reuniones próximas.
- LLM para bio, resumen de relación y prep.

## Permisos
RLS: cada usuario ve el perfil/historia según lo que puede ver (lo suyo + habilitado). Owner/admin, todo.

## Guardrails
- **Citar/linkear la fuente** de cada dato clave; bio y resúmenes **grounded**, sin fabricar.
- Marcar lo inferido vs lo confirmado.
- Respetar permisos y supresión.

Build order: contact_profiles sobre la memoria → bio + resumen de relación + extracción de datos clave → ficha 360 en la UI → detección de reuniones (Calendar) → tarjeta de prep → entrega en briefing/WhatsApp/asistente.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Briefing Diario Priorizado (estilo Kinso "lo que importa")

> Pegá esto en el MISMO proyecto de Lovable. Cada mañana, cada miembro abre la app (o recibe un WhatsApp) con un resumen de lo que importa, ordenado por lo que necesita su atención primero. Respeta los permisos (RLS).

---

## Qué hace
Un briefing matutino por usuario: "Buenos días {nombre}. Tenés 4 nuevas y 5 conversaciones activas." + una lista priorizada de lo que necesita acción, con un clic para saltar a cada ítem.

## Qué agrega y prioriza
Junta y ordena, por usuario, lo que hoy necesita atención:
- **Respuestas calientes** sin contestar (interesado / alta probabilidad de cierre).
- **Aprobaciones pendientes** (borradores esperando tu OK).
- **Time-sensitive:** leads que dijeron "antes de fin de mes", reuniones de hoy, follow-ups que vencen.
- **Follow-ups vencidos** de la cadencia.
- **Movimiento del pipeline:** nuevos calificados, deals que avanzaron o se enfriaron.
- **Salud de la campaña:** enviados, rebotes, bajas, alertas.
- **Leads nuevos** sourced ayer.

## Priorización
Ordenar por una mezcla de: urgencia temporal (deadline/reunión hoy), probabilidad de cierre, y si requiere acción tuya (aprobación). Lo que necesita tu atención primero va arriba. El LLM sintetiza un resumen corto y accionable, en el idioma del usuario.

## Entrega
- **Dashboard:** pantalla "Hoy" con el saludo, los contadores (nuevas / activas) y la lista priorizada (cada ítem linkea al lead/hilo).
- **WhatsApp (vía el agente):** DM matutino con el top de ítems; podés responder comandos ("mostrame el de Figma", "aprobá el borrador 2").
- Horario configurable (default: días hábiles a la mañana). Reusa el scheduler existente.

## Data model
**briefings** — id, user_id, date, greeting, counters (jsonb: new, active), items (jsonb: [{type, title, lead_id, priority, due, link}]), summary_text, created_at.
Reusa `replies`, `follow_ups`, `leads.stage`, `close_probability` y stats de campaña.

## Permisos
El briefing de cada usuario se arma **solo con lo que puede ver** (RLS): lo suyo + lo que el owner le habilitó. El owner/admin puede tener además una vista de organización.

## MCP tools (mismo `/mcp`)
- `get_briefing(user_id, date)` → el briefing del día.
- `generate_briefing(user_id)` → forzar regeneración.

## Guardrails
- Filtrado por RLS (nunca ítems fuera de permisos).
- Cada ítem linkea a su fuente (auditable).
- Priorización explicable (por qué está arriba).

Build order: agregador de señales (respuestas/aprobaciones/follow-ups/pipeline/salud) → scoring de prioridad → síntesis LLM por usuario → pantalla "Hoy" en el dashboard → entrega por WhatsApp → scheduling matutino.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Asistente Conversacional "Ask" con Voz (estilo Kinso)

> Pegá esto en el MISMO proyecto de Lovable. Es la interfaz conversacional que se para sobre TODO el sistema: hablás o escribís y el asistente ejecuta — briefing, preguntas sobre contactos/conversaciones, redactar respuestas, comandos. Con voz de entrada y salida.

---

## Qué hace
Una barra **"Ask"** (texto + micrófono) desde donde el usuario le pide cosas al sistema, por escrito o hablando, y recibe la respuesta en texto y/o **hablada** ("Kinso is speaking…"). Modo manos libres.

Ejemplos:
- "Léeme el briefing de hoy." → módulo de briefing.
- "¿A quién conozco en tech en San Francisco?" → consulta sobre contactos (filtro industria + ubicación) vía memoria.
- "Respondé a Figma que sí, coordinamos el martes." → el redactor arma el borrador en tu voz → confirmás → envía.
- "Pausá los envíos" / "¿cuántos respondieron hoy?" → comandos y stats.

## Es un orquestador, no una capacidad nueva
El asistente **no duplica lógica**: interpreta la intención (LLM) y llama a las **MCP tools que ya existen** (briefing, búsqueda/memoria, redactor, mover lead, enviar, stats, pausar) → sintetiza la respuesta → la habla.

## Stack de voz
- **STT (voz → texto):** OpenAI Whisper o Deepgram. Transcribe el micrófono en la app **y** las notas de voz de WhatsApp.
- **TTS (texto → voz):** OpenAI TTS o ElevenLabs. Voz y idioma configurables (EN/PT/ES), autoplay opcional.
- **Orquestador LLM:** parsea intención → llama tools → responde → TTS.

## Canales
- **En la app:** la barra "Ask" (texto + mic).
- **Por WhatsApp:** mandás una **nota de voz** al agente → se transcribe → mismo pipeline → responde (texto o audio).

## Data model
**assistant_sessions** — id, user_id, started_at.
**assistant_messages** — id, session_id, role (`user`/`assistant`), content, audio_url (opcional), tool_calls (jsonb), created_at.
**voice_settings** — user_id, tts_voice, language, autoplay (bool).

## Permisos
RLS: el asistente solo responde sobre datos que el usuario puede ver (lo suyo + lo habilitado). Owner/admin, todo.

## Guardrails
- **Confirmación antes de acciones irreversibles** (enviar, pausar, dar de baja): "¿Confirmás?".
- **Citar fuentes** en respuestas factuales (usa la memoria).
- Aprobación humana para envíos a leads calientes.
- No exponer datos fuera de los permisos.

## Keys
STT (Whisper/Deepgram) + TTS (OpenAI/ElevenLabs) + LLM. Reusa las MCP tools del motor.

Build order: barra Ask (texto) + orquestador que llama las tools existentes → STT del micrófono → TTS de la respuesta → notas de voz por WhatsApp → settings de voz/idioma → confirmaciones para acciones irreversibles.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Jarvis: Copiloto de Voz con Skills

> Pegá esto en el MISMO proyecto de Lovable. Es la evolución del asistente "Ask": un copiloto de voz manos-libres, siempre disponible, que es **la cara del Orquestador y los 12 agentes**, y es **extensible por skills** (capacidades modulares que se agregan solas). Reemplaza/expande el módulo "Asistente Ask".

---

## Qué es
Le hablás ("Jarvis, …") y ejecuta: briefing, buscar, redactar y enviar, agendar, sourcing, generar documentos, controlar agentes — por voz, con respuesta hablada. También **habla solo** cuando algo lo amerita (proactivo).

## Voz (baja latencia, manos libres)
- **Wake word "Jarvis"** o push-to-talk; conversación continua con **barge-in** (podés interrumpirlo).
- **STT en streaming** (Deepgram / Whisper) + **TTS en tiempo real** (ElevenLabs / OpenAI). Voz, idioma y wake word configurables por usuario.

## Sistema de Skills (lo importante)
Un **registro de skills** declarativo y extensible. Cada skill define:
`name` · `description` · `trigger_examples` (frases) · `params_schema` · `executor` (qué MCP tool o agente llama) · `confirm_required` (bool) · `roles` (quién puede invocarla).
Jarvis hace: **intención → seleccionar skill → completar parámetros (preguntando si falta algo) → ejecutar → hablar el resultado.** Sumar una skill nueva = agregar un registro, sin reescribir el asistente.

### Catálogo inicial de skills (mapea a lo ya construido)
- **Briefing:** "dame el resumen de hoy" → `get_briefing`.
- **Buscar/Preguntar:** "¿en qué quedamos con Figma?" → `search_conversations` / `ask`.
- **Redactar + enviar:** "respondé a X que sí" → Copywriter → confirmar → enviar.
- **Enviar tanda:** "mandá la tanda de hoy" → `create_todays_batch` + `send_batch` (confirmación).
- **Agendar:** "agendá con X el martes 3pm" → Agendador.
- **Leads:** "agregá a … a no-contactar" → `add_suppression`; "¿quién respondió hoy?" → `list_replies`.
- **Stats/Pipeline:** "¿cómo viene la campaña?" → `get_stats` / `get_pipeline_stats`.
- **Sourcing:** "traé más leads de fintech" → `run_sourcing`.
- **Documentos:** "armá el shortlist para X" / "generá la propuesta" → Talento + Documentos.
- **Perfil/Prep:** "prepárame para la reunión con X" → Research/360.
- **Control:** "pausá los envíos" → `pause`; kill switch.
- **Meta:** "recordame en una hora …", "programá esto cada mañana" → tareas programadas.

## Ruteo
Jarvis es el **front-end de voz del Orquestador**: la skill puede resolverse directo (MCP tool) o delegarse a un agente. Encadena pasos y **escala al humano** lo irreversible (confirmación hablada).

## Proactivo (estilo Jarvis)
Puede iniciar la conversación: "Che, Figma respondió interesado — ¿te leo el borrador?". Usa el mismo canal de notificaciones (Concierge/WhatsApp).

## Superficies
App de escritorio, teléfono (móvil), y **notas de voz de WhatsApp** (se transcriben → mismo pipeline).

## Data model
**skills** — id, name, description, trigger_examples (text[]), params_schema (jsonb), executor (jsonb: tool/agent), confirm_required, roles (text[]), enabled.
**skill_invocations** — id, user_id, skill_id, params, result, confirmed_by, ts.
**voice_settings** — user_id, wake_word, tts_voice, language, persona, proactive (bool).
**voice_sessions** — id, user_id, started_at, transcript_ref.

## Integraciones
- STT streaming + TTS realtime + **wake word** (ej. Picovoice).
- **LLM con function-calling** sobre el registro de skills + las MCP tools del motor.
- Reusa TODO lo construido (agentes, memoria, documentos, tareas programadas).

## Guardrails
- **Confirmación hablada** antes de acciones irreversibles (enviar, pausar, borrar).
- **Skills con permisos por rol**; RLS en los datos.
- **Audit** de cada invocación (quién, qué skill, qué resultó).
- Kill switch global (para Jarvis y los agentes).

Build order: registro de skills + ejecutor (function-calling sobre MCP) → texto primero (reusa "Ask") → STT streaming + TTS realtime → wake word + barge-in → confirmaciones habladas → proactivo → notas de voz de WhatsApp → catálogo de skills completo + permisos.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Auto-etiquetado de Conversaciones por Tema (estilo Kinso)

> Pegá esto en el MISMO proyecto de Lovable. Cada mensaje/hilo, en cualquier canal, se etiqueta solo por tema —aprendiendo del contexto— sin organizar nada a mano. Alimenta el tablero, la búsqueda y el briefing.

---

## Qué hace
Aprendiendo el contexto de tus conversaciones en distintas plataformas, el sistema **etiqueta automáticamente cada mensaje con un tema relevante** (ej.: "Engineering Hiring", "Investor Update", "Team Building", "Strategic Alliances"), con color. Sin organización manual.

## Capacidades
- **Auto-label:** un LLM clasifica cada mensaje/hilo (email · WhatsApp · Slack) en uno o varios **temas**, con color y **confianza**. Multi-etiqueta.
- **Taxonomía que se descubre sola:** los temas emergen de patrones recurrentes (clustering de embeddings) y son **editables** por el usuario: renombrar, fusionar, color, fijar, borrar. Taxonomía compartida a nivel org + temas propios.
- **En todos lados:** filtrar el inbox / tablero / búsqueda por tema; **agrupar el briefing** por tema; analytics (volumen por tema, tendencias).
- **Aprende:** mejora a medida que llegan mensajes y sugiere temas nuevos; tus correcciones lo afinan.

## Data model
**topics** — id, org_id, name, color, source (`auto`/`manual`), pinned (bool), created_at.
**message_topics** — id, subject_type (`message`/`thread`), subject_id, topic_id, confidence, created_at.
Reusa los mensajes de todos los canales y los embeddings de la memoria.

## Integraciones
- **LLM** para etiquetar; **embeddings** (memoria) para descubrir/clusterizar temas.
- Reusa los datos de email/WhatsApp/Slack/replies ya ingestados.

## Dónde se usa
- **Tablero:** las tarjetas muestran los tags de tema; filtrás por tema.
- **Búsqueda:** facetas por tema ("mostrame todo lo de Investor Update").
- **Briefing:** agrupa lo del día por tema.
- **Routing/insight:** el tema puede sugerir el funnel o la prioridad.

## Permisos
RLS: cada usuario ve/filtra por tema solo en lo que puede ver.

## Guardrails
- **Multi-etiqueta con confianza;** los de baja confianza se marcan para revisión.
- El usuario puede **corregir** una etiqueta → alimenta el aprendizaje.
- Sin fugar contenido entre permisos; temas org-level pero contenido filtrado por RLS.

Build order: labeling por LLM sobre mensajes nuevos → topics + message_topics → descubrimiento de taxonomía (clustering) → edición de temas (renombrar/fusionar/color) → filtros por tema en tablero/búsqueda/briefing → correcciones que retroalimentan.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Módulo de Documentos (hub auto-organizado)

> Pegá esto en el MISMO proyecto de Lovable. Un hub donde viven todos los documentos del negocio, **organizados solos** por tipo, contacto/empresa/deal y tema — sin carpetas manuales. Se apoya en la memoria (embeddings) y alimenta el contexto proactivo.

---

## Qué hace
- Guarda **todos los documentos relevantes**: propuestas, contratos, **shortlists de devs**, price guides, casos de éxito, plantillas, CVs/perfiles, briefs, facturas, y los **adjuntos** que llegan por email/WhatsApp.
- Los **auto-organiza dinámicamente**: la IA clasifica cada doc por **tipo**, lo enlaza al **contacto / empresa (account) / deal**, y lo etiqueta por **tema**. Las "carpetas" son **vistas inteligentes** (filtros), no estructura manual.
- **Genera** documentos desde plantillas (propuesta, cotización, shortlist) con los datos del deal.
- **Busca** en lenguaje natural ("la última propuesta de Figma", "el contrato de X") y **surface proactivo** (el asset correcto aparece cuando hace falta — módulo de conexión de conversaciones).

## Auto-organización (dinámica)
- **Clasificación IA:** cada doc → `type` (propuesta / contrato / shortlist / price_guide / caso / plantilla / CV / brief / factura / otro), con confianza.
- **Enlace automático:** por contacto/account/deal (matcheando remitente, empresa, hilo).
- **Temas:** reusa el auto-etiquetado por tema.
- **Vistas inteligentes:** "Propuestas abiertas", "Contratos por firmar", "Shortlists enviados esta semana", "Docs de {cuenta}" — todas queries, se actualizan solas.

## Ingesta
- **Subida manual** (drag & drop).
- **Adjuntos de email/WhatsApp** capturados automáticamente e indexados.
- **Generados** por el sistema (propuestas, shortlists).
- **Docs del proyecto** (specs, planes) si querés tenerlos dentro.

## Data model
**documents** — id, org_id, title, type, source (`upload`/`generated`/`email_attachment`/`whatsapp`), file_ref (Supabase Storage) o url, account_id, contact_id, deal_id, topics (text[]), version, status, created_by, created_at.
**document_versions** — id, document_id, version, file_ref, note, created_at.
**smart_views** — id, org_id, name, filter (jsonb), pinned.
**doc_templates** — id, type, name, body/ref, variables (jsonb).

## Integraciones
- **Supabase Storage** para archivos; **embeddings** (memoria) para búsqueda semántica del contenido.
- **LLM** para clasificar, resumir y **generar** desde plantillas.
- Reusa `accounts`/`contacts`/`deals`, el auto-etiquetado por tema y el módulo de conexión (surface proactivo).

## UI
- Grid/listado con filtros (tipo, cuenta, tema, fecha) y **vistas inteligentes** fijadas.
- Ficha de documento: preview, versiones, enlaces (contacto/deal), acciones (enviar, generar nueva versión).
- Botón "Nuevo desde plantilla" (propuesta/shortlist/cotización).

## MCP tools (mismo `/mcp`)
- `search_documents(query)`, `get_document(id)`, `list_documents(filters)`, `generate_document(template, deal_id, vars)`, `link_document(doc_id, entity)`.

## Permisos y guardrails
- **RLS:** cada uno ve los documentos según lo que puede ver (contacto/deal propio + habilitado); owner/admin, todo.
- Versionado (no se pierde nada); auditoría de accesos.
- Clasificación con confianza; los dudosos se marcan para revisión.

Build order: storage + `documents` + subida/ingesta de adjuntos → clasificación IA + enlace a contacto/deal + temas → índice + búsqueda semántica → vistas inteligentes → generación desde plantillas → tools MCP + surface proactivo.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Módulo de Equipo, Buzones y Permisos (Multi-usuario)

> Pegá esto en el MISMO proyecto de Lovable. Convierte la app en multi-usuario: cada persona del equipo envía desde su propio correo, ve lo suyo por defecto, y el owner (vos) decide quién puede ver los correos de quién. Todo protegido con Row Level Security de Supabase.

---

Add a **Team, Mailboxes & Permissions layer** to the DevUps Outreach Engine. Multiple team members, each sending from their own mailbox, with owner-controlled visibility. Enforce isolation with Supabase Row Level Security (RLS).

## Data model (Postgres + Supabase Auth)
**organizations** — id, name, domain (devups.io), owner_user_id, created_at.

**users** (Supabase Auth + profile) — id, email, full_name, org_id, role (enum: `owner`, `admin`, `member`), status (enum: `invited`, `active`, `disabled`), created_at.

**mailboxes** — id, org_id, user_id (dueño del buzón), email_address, provider (`gmail`), oauth_refresh_token (secret ref), daily_limit (default 50), warmup_stage, status (enum: `active`, `paused`, `disconnected`).

**visibility_grants** — id, org_id, grantee_user_id, target_user_id, access (enum: `read`, `read_write`), created_by, created_at. (Quién puede ver los datos de quién.)

**Add `org_id`, `mailbox_id`, `assigned_user_id`** to `leads`, `email_log`/emails, `replies`, `follow_ups`, `sourced_prospects`.

## Auth
Supabase Auth con Google sign-in (o magic link). Toda sesión queda atada a un `org_id`. Nada es accesible sin sesión.

## Roles y capacidades
- **owner / admin (vos):** invitar y quitar miembros, conectar/autorizar buzones para cualquiera, fijar límites diarios, **crear y revocar permisos de visibilidad**, y ver/gestionar TODO en la organización.
- **member:** conectar su propio buzón y enviar desde él; ver sus propios leads/correos/respuestas; ver los de otro miembro SOLO si el owner le dio un `visibility_grant`.

## Agregar los correos de la empresa — dos caminos
1. **OAuth por persona (recomendado, simple):** cada miembro entra y conecta su Gmail con un botón "Conectar mi buzón". Vos los invitás por email; ellos autorizan su propia cuenta. Escala solo, sin permisos de admin de Google.
2. **Delegación a nivel dominio de Google Workspace (avanzado):** si sos admin del Workspace de devups.io, autorizás una service account con *domain-wide delegation* para enviar en nombre de cualquier dirección `@devups.io`. Esto te deja **agregar TODOS los correos de la empresa de una sola vez**, sin que cada persona conecte el suyo. Requiere consentimiento de admin y configurar los scopes de Gmail. Documentá ambos y dejá el owner elegir.

## Modelo de visibilidad (el pedido central)
- **Por defecto, cerrado:** un miembro ve solo las filas donde `assigned_user_id` = él (o el `mailbox_id` es suyo).
- **El owner habilita:** crea `visibility_grants` para que el miembro X vea los datos del miembro Y (solo lectura o lectura/escritura).
- **Owner/admin:** visibilidad total de la organización.

## Enforcement — Row Level Security (RLS)
Aplicá RLS en `leads`, emails, `replies`, `follow_ups`, `mailboxes`. Permitir una fila si:
`row.org_id = auth.org_id` **Y** ( es owner/admin **O** `row.assigned_user_id = auth.uid()` **O** existe `visibility_grant(grantee = auth.uid(), target = row.assigned_user_id)` ).
La UI nunca debe ser la única barrera — la RLS es la fuente de verdad.

## Cambios en el envío (multi-buzón)
- El job diario **itera por cada buzón activo**, respetando el `daily_limit` y el `warmup_stage` propio de ese buzón (los buzones nuevos arrancan bajo: 20 → 40 → … para proteger cada dominio/cuenta).
- Los leads se **asignan** a un buzón/usuario (round-robin o por territorio/owner, configurable). Cada buzón manda lo suyo desde su propia dirección.

## Dashboard
- **Página de Equipo (owner):** lista de miembros con rol y estado de buzón, límites diarios; botón "Invitar miembro"; "Conectar buzón"; y una **matriz de visibilidad** (quién puede ver a quién) para dar/quitar accesos con un clic.
- **Vista de miembro:** "Mis leads / Mi bandeja / Mi pipeline"; más pestañas para cada compañero al que el owner le dio acceso.
- Todo filtrado por RLS automáticamente.

## MCP tools (mismo `/mcp`, auth por path-token; acciones admin solo owner/admin)
- `get_team()`, `list_mailboxes()`, `invite_member(email, role)`, `set_visibility_grant(grantee, target, access)`, `revoke_visibility_grant(id)`, `get_stats(by: mailbox|user)`.

## Guardrails
- Aislamiento por RLS en el backend (no confiar solo en la UI).
- Solo owner/admin gestionan miembros, buzones y permisos.
- Warmup y límite por buzón (no mezclar reputación entre cuentas).
- **Audit log** de invitaciones, grants y acciones de admin.

## Keys / setup
Reusa Supabase Auth. Para OAuth por persona: el mismo flujo de Gmail que ya existe, por usuario. Para Workspace: service account + domain-wide delegation (scopes `gmail.send`, `gmail.readonly`).

Build order: auth + organizations/users → mailboxes (per-user OAuth) → org_id/assigned_user_id en tablas → RLS policies → team dashboard + visibility matrix → multi-mailbox sending → MCP admin tools.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Agente de Operaciones en WhatsApp (control · notificaciones · log)

> Pegá esto en el MISMO proyecto de Lovable. **NO es un canal para leads.** Es un agente interno: un número de WhatsApp conectado al sistema que avisa al equipo cuando pasan cosas, recibe comandos ("enviá / no envíes / pausá"), y documenta la conversación del grupo como registro auditable.

---

## Realidad técnica de los grupos (leer primero)
Oficialmente WhatsApp **no soporta** un bot que se siente en un grupo y responda ahí (la nueva Group API de Meta es de elegibilidad limitada y sin bot-participante). Para leer/responder en un grupo del equipo se usa una librería **no oficial (Baileys / whatsapp-web.js)** sobre WhatsApp Web: funciona, pero va contra los ToS y el número puede ser baneado. Por eso el diseño tiene dos capas:

- **Capa A — 1:1 (compliant, cero riesgo):** vía WhatsApp Cloud API oficial. El agente te manda alertas a tu número personal y recibe tus comandos por DM. Requiere que los miembros hagan opt-in (mensajean al bot primero).
- **Capa B — Grupo (lo pedido, con riesgo de ban):** un **número dedicado** (separado de los buzones de envío) entra al grupo del equipo vía Baileys, documenta todo, avisa y toma comandos ahí. Si lo banean, no afecta los envíos.

Hacé ambas capas configurables; el owner elige cuál usar.

## Capacidades
1. **Notificaciones (sistema → WhatsApp):** respuesta caliente recibida, aprobación pendiente antes de enviar, resumen diario de envíos, alerta de salud del dominio (rebotes), nuevo lead calificado, resultado de un run de sourcing. Destino configurable: tu número personal y/o el grupo.
2. **Comandos (WhatsApp → sistema):** el mensaje entrante pasa por un parser IA que lo mapea a las MCP tools del motor y ejecuta. Ejemplos: "enviá el borrador de Figma", "no lo mandes", "pausá los envíos", "quién respondió hoy", "resumen de la campaña", "agregá a juan@x.com a no-contactar".
3. **Aprobaciones (human-in-the-loop):** ante un lead caliente, el agente escribe: "Lead X (Figma) respondió interesado — borrador: '…'. ¿Envío? (sí / editá: … / no)". La respuesta dispara la acción.
4. **Log / auditoría:** cada mensaje del grupo + cada comando + la acción resultante se guardan en la base, buscables, con quién dijo qué y qué acción resultó.

## Arquitectura
- **Número dedicado** conectado al sistema (Cloud API para 1:1; Baileys en un worker aparte para el grupo).
- **Webhook / socket** recibe inbound → **parser de intención (LLM, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`)** → llama a las MCP tools del motor (`send_batch`, `pause`, `resume`, `list_replies`, `approve_reply`, `add_suppression`, `get_stats`) → responde en WhatsApp + registra.
- Corre junto al motor existente; reutiliza su auth y su capa de equipo (RLS).

## Data model
**ops_messages** — id, source (`group`/`dm`), from_number, from_name, body, is_command (bool), created_at.
**ops_commands** — id, ops_message_id, parsed_intent, target (lead/campaña/etc), action_called, result (jsonb), actor_number, status (`executed`/`rejected`/`needs_confirm`), created_at.
**notifications** — id, type, payload (jsonb), sent_to, channel, sent_at.
**authorized_numbers** — id, phone, user_id, can_command (bool), created_at. (Allowlist.)

## Guardrails
- **Allowlist:** solo números en `authorized_numbers` pueden dar comandos; el resto es solo log.
- **Confirmación obligatoria** para acciones irreversibles (enviar a leads reales, dar de baja): el agente pide "confirmá con SÍ" antes de ejecutar.
- **Todo se audita** (quién ordenó qué y qué pasó).
- El número del agente **no** se usa para enviar a leads (aislado del riesgo de reputación).

## Setup / keys
Cloud API (Capa A): WABA + phone_number_id + access_token + webhook. Grupo (Capa B): worker con Baileys en un número dedicado. LLM key para el parser. Reusa las MCP tools del motor.

Build order: número dedicado + recepción de mensajes → parser de intención → notificaciones salientes (empezar por "respuesta caliente" y "resumen diario") → comandos read-only ("quién respondió", "resumen") → comandos con confirmación (enviar/pausar) → log/auditoría + allowlist.


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Analytics de Conversión + A/B Testing

> Mide qué convierte de verdad (fuente, segmento, plantilla, remitente, funnel) hasta reunión y deal ganado, y prueba variantes de asunto/copy/cadencia. Pegalo en el proyecto del motor.

---

## Métricas (por dimensión)
Para cada **fuente / plantilla / remitente / funnel / segmento**: enviados, entregados, tasa de respuesta, **respuesta positiva**, reuniones agendadas, ganados, y (si aplica) ingreso. Más: conversión del funnel etapa a etapa y **time-to-reply**.

> Nota de deliverability: el *open tracking* con pixel puede dañar la entregabilidad. Priorizá **respuesta / reunión / ganado** como métricas primarias; open como secundaria y opcional.

## A/B testing
- Definir **experimentos** con variantes: asunto, apertura, CTA, cadencia.
- **Split** del tráfico (asignación por lead), medir la métrica objetivo (ej. respuesta positiva), y **elegir ganador** con chequeo de significancia (o sugerirlo para aprobación).
- Aplica al primer toque (genérico vs personalizado) y a los follow-ups.

## Data model
**events** — id, lead_id, type (`sent`/`delivered`/`reply`/`positive_reply`/`meeting`/`won`/`lost`), template_id, variant_id, source, sender_id, funnel_id, ts.
**experiments** — id, name, target_metric, status (`running`/`done`), created_at.
**variants** — id, experiment_id, name, config (jsonb).
**assignments** — id, experiment_id, lead_id, variant_id.

## Dashboard
- Conversión por fuente/plantilla/remitente/funnel/segmento, con filtro de fecha.
- Resultados de experimentos con tamaño de muestra y significancia; botón "aplicar ganador".
- Tarjetas: reply rate, positive rate, reuniones, ganados, y **costo por reunión** (cruza con costo de APIs).

## MCP tools
`get_analytics(dimension, range)`, `list_experiments()`, `create_experiment(config)`, `apply_winner(experiment_id)`.

## Permisos
RLS: cada uno ve su performance; owner/admin, la del equipo.

Build order: registro de `events` en cada paso → dashboard de conversión por dimensión → framework de experimentos + asignación → cálculo de ganador/significancia → costo por reunión (cruce con gasto de APIs).


<div style="page-break-before:always"></div>

---

# Prompt para Lovable — Gobierno & Datos (CRM · ICP loop · Agent-ops · Privacidad)

> Cuatro piezas de gobierno que hacen el sistema sólido y aprendible. Pegalo en el proyecto del motor.

---

## 1 · CRM = este sistema (fuente de verdad)
Este sistema **es el CRM**. Ingesta **todos los mensajes enviados y recibidos** en todos los canales (email, WhatsApp, etc.) y los asocia al **contacto** y a la **empresa (account)**, con el contexto completo. (La memoria unificada ya indexa; acá se formaliza el objeto CRM.)
- **accounts (empresas)** — id, name, domain, industry, size, relationship (`prospect`/`customer`/`partner`), created_at.
- Enlazar `leads`/`contacts` → `account`.
- **Supresión de los tuyos (crítico):** nunca mandar en frío a **clientes actuales** ni a contactos con **deal activo**. Chequeo automático contra `accounts.relationship = customer` y deals abiertos antes de cualquier envío.

## 2 · Loop de resultados → ICP
Que el sistema **aprenda de lo que cierra**, no solo de tu estilo.
- Registrar outcome por lead: ganado/perdido, calidad de reunión, motivo.
- **Analizar patrones** de los ganados (industria, tamaño, señal, rol, fuente) vs. los que no responden.
- **Ajustar el scoring/ICP del sourcing:** subir el peso de lo que correlaciona con ganar; bajar lo que no. Reporte de ICP periódico con **revisión humana** antes de aplicar.
- Data: **outcomes** (lead_id, result, reason, meeting_quality, ts); **icp_weights** (feature, weight, updated_at).

## 3 · Agent-ops (observabilidad de los agentes)
- **Trazas:** cada decisión de agente = qué disparó, qué tools llamó, qué resultó (auditable).
- **Costo:** gasto por agente/modelo/API (LLM, Apollo, Anymail, TTS) con **presupuestos y alertas**.
- **Evals:** suite de casos de prueba (input → comportamiento esperado) que corre en cada cambio de prompt/modelo.
- **Kill switch:** pausa global de todos los agentes con un clic.
- Data: **agent_traces** (agent, trigger, tool_calls jsonb, result, cost, ts); **budgets** (scope, limit, spent).

## 4 · Privacidad / DSR
- **Data Subject Requests:** exportar y **borrar** todos los datos de una persona a pedido.
- **Retención:** políticas por tipo de dato (ej. purgar conversaciones frías tras X meses).
- **Residencia:** considerar dónde se guardan datos de leads LATAM/EU.
- **PII + consentimiento + cifrado** en reposo; rastro de consentimiento (ya en Compliance).
- Data: **dsr_requests** (subject_email, type `export`/`delete`, status, requested_at); **retention_policies** (data_type, ttl_days).

## Guardrails
- Supresión de clientes/deals activos **antes** de todo envío (bloqueante).
- Kill switch y presupuestos por encima de todos los agentes.
- DSR y retención cumplidos y auditables; RLS en todo.

Build order: accounts + supresión de clientes/deals → outcomes + ajuste de ICP (con revisión) → agent_traces + costos/presupuestos + kill switch → evals → DSR (export/delete) + retención.


<div style="page-break-before:always"></div>

---

# DevUps — Mapa de los 12 agentes (rol · disparadores · herramientas · handoffs)

El **Orquestador** coordina; los **12 agentes** hacen el trabajo. Regla base: los agentes **proponen**, y todo lo caliente/irreversible pasa por aprobación humana (vía el Concierge). Los dos **Guardianes** tienen poder de veto sobre el resto.

---

## 0 · Orquestador (Supervisor) — el que reparte
- **Rol:** no ejecuta tareas; recibe cada evento, decide qué agente lo maneja, encadena pasos y escala al humano.
- **Disparadores:** cualquier evento (nuevo lead, respuesta entrante, cron matutino, comando del Concierge, alerta de un Guardián).
- **Herramientas:** invoca a cualquier agente; lee estado global (`get_stats`, `get_pipeline_stats`).
- **Handoffs:** enruta al especialista correcto → recibe resultado → encadena el siguiente → escala al Humano cuando la política lo pide.

---

## Interfaz

### 1 · Concierge (WhatsApp / voz) — el puente con vos
- **Rol:** interfaz humana del enjambre: avisa, recibe comandos, gestiona aprobaciones.
- **Disparadores:** mensaje entrante del owner/equipo (WhatsApp, voz, barra "Ask"); notificación que el Orquestador quiere emitir.
- **Herramientas:** `send_whatsapp_template`, STT/TTS, `ask`/`search_conversations`, `get_briefing`; parser de comandos → Orquestador.
- **Handoffs:** comando → Orquestador; aprobación/decisión del humano → de vuelta al agente que esperaba. **Es la puerta de aprobación.**

---

## Adquirir

### 2 · Sourcing — consigue leads
- **Rol:** busca prospectos, obtiene el email verificado, dedupe, prioriza e importa.
- **Disparadores:** cron diario (antes del envío); comando "traé más leads".
- **Herramientas:** `run_sourcing(source)`, Gojiberry/Apollo/TheirStack search, **Anymail** verify, `import_leads`, `get_sourcing_stats`, `add_suppression`.
- **Handoffs:** leads verificados → tabla `leads` (Motor) → quedan listos para **Envío**. Reporta al Orquestador.

---

## Interactuar

### 3 · Copywriter — redacta en tu voz
- **Rol:** escribe borradores (respuestas y follow-ups) en la voz del dueño, con contexto y assets.
- **Disparadores:** Triage marcó "pregunta/interesado"; toca un follow-up; comando "respondé a X".
- **Herramientas:** `preview_email`, redactor LLM (voice_profile), `suggest_context`, `find_related`, `get_contact_timeline`.
- **Handoffs:** borrador → Concierge/Humano para aprobar (si caliente) → **Envío**. Devuelve al Triage/Orquestador.

### 4 · Envío — manda
- **Rol:** dispara la tanda del día respetando warmup, límites y salud.
- **Disparadores:** cron diario; batch listo; comando "enviá".
- **Herramientas:** `create_todays_batch`, `send_batch`, `list_pending_leads`, `get_stats`. **Consulta al Guardián de Entregabilidad antes.**
- **Handoffs:** tras enviar → **Follow-up** (programa cadencia); queda a la espera de respuesta (Triage). Reporta al Orquestador.
- **Veto:** no envía si Entregabilidad está en alerta o Compliance bloquea.

### 5 · Follow-up — insiste con criterio
- **Rol:** corre las cadencias de los que no responden y las corta al primer signo.
- **Disparadores:** lead enviado sin respuesta + venció el paso (+3d / +7d / +14d).
- **Herramientas:** `schedule_followup`, `send_batch` (bump en el hilo), `get_stats`.
- **Handoffs:** si el lead responde → **Triage**; si se agota → frío. Reporta al Orquestador.

---

## Convertir

### 6 · Triage de respuestas — el semáforo
- **Rol:** clasifica cada respuesta, asigna probabilidad de cierre y rutea.
- **Disparadores:** detección de respuesta entrante (email o WhatsApp).
- **Herramientas:** `list_replies`, `classify_reply`, `set_stage`, `get_pipeline_stats`, `add_suppression`.
- **Handoffs:** interesado/pregunta → **Copywriter** (+ **Agendador** si pide reunión); más adelante → **Follow-up**/nurture; referido → **Sourcing** (nuevo lead); no/baja → **Compliance**. Avisa lo caliente al **Concierge**.

### 7 · Agendador — reserva la reunión
- **Rol:** propone horarios reales, reserva y crea la reunión, recuerda.
- **Disparadores:** Triage marcó "reunión/interesado"; comando "agendá con X".
- **Herramientas:** `propose_slots` (free/busy), `book_meeting` (evento + Meet), recordatorios, `set_stage(→Reunión)`.
- **Handoffs:** reunión creada → **Research/360** (prep) y pipeline a Reunión. Avisa al Concierge.

---

## Entender (servicios)

### 8 · Research / 360 — te prepara
- **Rol:** arma el perfil del contacto, la bio y la prep de reunión.
- **Disparadores:** nuevo contacto relevante; reunión próxima (calendario); "prepárame para X".
- **Herramientas:** `get_contact_timeline`, `summarize_contact`, enrich (Apollo), `generate_bio`, `meeting_prep`.
- **Handoffs:** prep/bio → **Briefing** y **Concierge** (antes de la reunión); aporta contexto al **Copywriter**.

### 9 · Memoria / Bibliotecario — el que sabe todo
- **Rol:** indexa cada mensaje, conecta canales, responde búsquedas y auto-etiqueta por tema. Es un **servicio** que otros consultan.
- **Disparadores:** cada mensaje nuevo (indexa); consulta de búsqueda; pedido de contexto de otro agente.
- **Herramientas:** `search_conversations`, `find_related`, `suggest_context`, auto-tag (topics), `get_contact_timeline`.
- **Handoffs:** sirve contexto/assets a **Copywriter**, **Research/360**, **Briefing** y **Concierge**.

### 10 · Briefing — lo que importa hoy
- **Rol:** cada mañana arma el resumen priorizado por usuario.
- **Disparadores:** cron matutino; "dame el briefing".
- **Herramientas:** `generate_briefing`/`get_briefing`, `get_pipeline_stats`, `list_replies` (pendientes).
- **Handoffs:** entrega al **Concierge** (dashboard/WhatsApp/voz). Reporta prioridades al Orquestador.

---

## Guardianes (transversales, con veto)

### 11 · Entregabilidad & Salud — protege el dominio
- **Rol:** vigila rebotes y reputación; puede **pausar todo** solo.
- **Disparadores:** continuo/post-envío; webhooks de rebote; umbrales (>5%).
- **Herramientas:** `get_stats`, `pause`, `resume`, ajuste de warmup/límites.
- **Handoffs / veto:** si la salud baja → `pause` (frena a **Envío**) + alerta al **Concierge**.

### 12 · Compliance — mantiene la ley
- **Rol:** hace cumplir opt-out/supresión (cross-canal), CAN-SPAM/GDPR y la política de WhatsApp.
- **Disparadores:** cada intento de contacto (pre-check); baja/opt-out entrante.
- **Herramientas:** `add_suppression`, `check_suppression`, registro de consentimiento, chequeos de política.
- **Handoffs / veto:** bloquea o permite a **Envío**, **Follow-up** y **WhatsApp**.

---

## Flujo happy-path (quién le pasa a quién)
`Sourcing → Envío → (no responde) Follow-up ↺ · (responde) Triage → Copywriter → Agendador → Research/360`

- **Memoria** y **Research** alimentan de contexto a Copywriter y Briefing (servicios, todos los consultan).
- **Briefing + Concierge** son la cara hacia el humano (avisos, aprobaciones, comandos).
- **Entregabilidad + Compliance** envuelven todo con poder de freno.
- **Orquestador** coordina y escala; el **humano** aprueba lo caliente.

## MVP recomendado
Orquestador · Sourcing · Copywriter · Triage · Entregabilidad · Concierge. Cubren el ciclo entero; el resto se suma cuando el volumen lo pida.


<div style="page-break-before:always"></div>

---

# DevUps — Checklist de Endurecimiento (build en Claude Code)

Antes de dar autonomía a los agentes. Los ítems **[BLOQUEANTE]** son no-negociables: sin ellos, los agentes NO envían ni ejecutan solos.

> Contexto: se construye en **Claude Code** (código real, versionado). Eso permite tests, CI, infra de producción y revisión del código generado. Los "prompts de Lovable" que armamos siguen valiendo como **specs de funcionalidad**; el build va en Claude Code.

---

## 1 · Secretos & tokens
- [ ] **[BLOQUEANTE]** Nada de secretos en el código ni en git. Usar un secrets manager (Doppler / Vault / AWS Secrets Manager / KMS). `gitleaks` en pre-commit y en CI.
- [ ] **[BLOQUEANTE]** Tokens OAuth (Gmail/Calendar) **cifrados en reposo** (KMS), por usuario, con **scopes mínimos** (`gmail.send`, `gmail.readonly`, calendar) y rotación/refresh seguro.
- [ ] Aislamiento por tenant/usuario: si un token se filtra, el daño se limita a ese buzón.
- [ ] Rotación de claves y del `MCP_TOKEN`; revocación fácil.

## 2 · Defensa contra prompt injection  (crítico — hoy es un hueco)
- [ ] **[BLOQUEANTE]** Tratar TODO input externo (emails, replies, WhatsApp, adjuntos) como **no confiable**. Separar "datos" de "instrucciones" en los prompts (el contenido del lead nunca es instrucción).
- [ ] **[BLOQUEANTE]** El contenido externo **nunca dispara acciones irreversibles** por sí solo (enviar, borrar, agendar, gastar). Esas acciones requieren un paso con validación/gate.
- [ ] **Function-calling con esquemas estrictos**; validar/parsear toda salida del LLM; rechazar lo malformado. Nada de "ejecutá lo que diga el texto".
- [ ] Allow-list de acciones por agente; el LLM no elige libremente qué tool llamar fuera de su set.
- [ ] Sanitizar/acotar contenido inyectado (límites de longitud, quitar instrucciones embebidas conocidas).

## 3 · Auth de MCP / APIs
- [ ] **[BLOQUEANTE]** MCP servers y endpoints con **auth real** (OAuth o bearer bien hecho, no el `?token=` de prototipo), TLS, y **rate limiting**.
- [ ] Validación de input en todos los endpoints; principio de menor privilegio.
- [ ] **RLS en la base** (Postgres): el aislamiento se impone en la DB, no en la UI.

## 4 · Datos & privacidad
- [ ] Cifrado en tránsito (TLS) y en reposo (DB + storage).
- [ ] Roles de DB de menor privilegio; **RLS** por org/usuario.
- [ ] **Audit log** de accesos y acciones (quién vio/hizo qué).
- [ ] **Minimización**: guardar solo lo necesario. Retención + **purga** por tipo de dato.
- [ ] **DSR** (export/delete a pedido). Revisar residencia de datos (LATAM/EU).
- [ ] **Backups cifrados con restore probado** (no sirve un backup que nunca restauraste).

## 5 · Guardrails de agentes (autonomía)
- [ ] **[BLOQUEANTE]** **Human-in-the-loop** para acciones irreversibles: enviar a leads reales, suprimir, agendar, gastar. Confirmación explícita.
- [ ] **[BLOQUEANTE]** **Kill switch global** (pausa todo) + pausa por agente. Probado.
- [ ] **Modo dry-run / simulación** antes de ejecutar en real (nunca sobre leads reales).
- [ ] **Suite de evals** (clasificación, redacción, ruteo): casos con salida esperada, corre en CI, bloquea merges que regresionen.
- [ ] **Umbrales de confianza**: lo dudoso va a humano, no a auto.
- [ ] **Presupuestos y rate caps por agente** (LLM/API/voz) con alertas y **auto-pausa** al excederse.
- [ ] Trazas de cada decisión de agente (trigger → tools → resultado), auditables.

## 6 · Confiabilidad / Ops
- [ ] **[BLOQUEANTE]** Scheduler real (cron de cloud / worker), **no** "corre con la app abierta".
- [ ] **[BLOQUEANTE]** **Idempotencia** en envíos: clave de dedupe por (lead, campaña) para **no re-enviar** en un retry.
- [ ] **Colas + reintentos + dead-letter** para envíos/enrich; backoff exponencial; **circuit breakers** en APIs externas (Gmail/Apollo/Anymail).
- [ ] **Observabilidad**: logs estructurados, tracing, métricas/dashboards, **alertas** (on-call), error tracking (Sentry).
- [ ] Degradación elegante: si una API externa cae, la cola **encola**, no crashea.
- [ ] Transacciones en la DB para evitar escrituras parciales.

## 7 · CI/CD & calidad (específico Claude Code)
- [ ] `CLAUDE.md` con convenciones, arquitectura y **guardrails** para que Claude Code genere con el estándar correcto.
- [ ] **Revisar el código generado** (no mergear a ciegas); usar `/security-review` en cambios sensibles.
- [ ] CI en cada PR: tests + lint + type-check + **secret scan** + evals de agentes.
- [ ] Entornos separados **dev / staging / prod**; feature flags; nunca testear con leads reales.
- [ ] Prompts y configs de agentes **versionados** en el repo.

## 8 · Compliance (bloqueante para outbound)
- [ ] **[BLOQUEANTE]** Supresión pre-envío (clientes, deals activos, bajas) **bloqueante** + anti-reenvío.
- [ ] Unsubscribe en cada correo + dirección física (CAN-SPAM). Opt-out **cross-canal**.
- [ ] Revisión legal del cold outreach por región (GDPR/LATAM).

---

## Puerta antes de autonomía (resumen bloqueante)
No se le da "enviar/actuar solo" a ningún agente hasta tener: **secretos en manager + tokens cifrados · defensa de prompt injection (datos≠instrucciones, sin acciones desde contenido externo) · auth real en MCP/APIs · human-in-the-loop para lo irreversible · kill switch · scheduler real + idempotencia · supresión bloqueante.**

Todo lo demás (evals, colas, observabilidad, DSR, dry-run) es "sí o sí pronto", pero la puerta de arriba es lo mínimo para no hacerte daño.


<div style="page-break-before:always"></div>

---

# DevUps — Índice de documentos del negocio

Catálogo organizado de todo lo generado en el proyecto. Cada ítem es un documento en tu carpeta de outputs. Estado: el **motor base ya está enviando** (76+ correos, 0 rebotes); el resto son **specs listos para pegar en Lovable** o **planes/research**.

---

## A · Estrategia & Planes
| Documento | Qué es |
|---|---|
| `devups-motor-de-leads-plan.md` | Plan definitivo del motor (Gojiberry + Apollo + Anymail): roles, flujo, costos, fases, fuentes ampliadas. |
| `devups-fuentes-de-leads.md` | Informe de research: fuentes de leads, enrich y señales, con precios y match rates 2026. |
| `devups-mapa-de-agentes.md` | Los 12 agentes: rol, disparadores, MCP tools y handoffs + flujo happy-path. |
| `devups-indice-documentos.md` | Este índice. |

## B · Adquisición (motor de leads)
| Documento | Qué es | Estado |
|---|---|---|
| `devups-outreach-lovable-prompt.md` | Motor base: tabla de leads, dedup, idioma, prioridad, envío por Gmail, cron diario, MCP. | **Corriendo** |
| `devups-sourcing-module-lovable-prompt.md` | Sourcing: Gojiberry + Apollo + Anymail (verifica email), dedup, importación. | Diseñado |
| `devups-personalizacion-senal-lovable-prompt.md` | Primer toque personalizado con la señal del lead (vacante/tech stack). | Diseñado |
| `devups-deliverability-escala-lovable-prompt.md` | Deliverability a escala: dominios/buzones 2º, warmup, rotación, salud. | Diseñado |

## C · Conversión, CRM & Entrega
| Documento | Qué es |
|---|---|
| `devups-modulo-respuestas-lovable-prompt.md` | Ciclo de respuestas: detección, clasificación IA, probabilidad de cierre, ruteo, cadencias. |
| `devups-redactor-voz-contexto-lovable-prompt.md` | Redactor que escribe en tu voz, con contexto y assets; aprende de tus ediciones. |
| `devups-tablero-pipeline-funnels-lovable-prompt.md` | Tablero kanban del pipeline con múltiples funnels configurables. |
| `devups-calendario-agendamiento-lovable-prompt.md` | Calendario + agendamiento automático (Google/Outlook + Meet), recordatorios. |
| `devups-integracion-talento-matching-lovable-prompt.md` | Integración con el sistema de talento (vía MCP) + matching dev↔necesidad + shortlist. |

## D · Inteligencia, Memoria & Documentos
| Documento | Qué es |
|---|---|
| `devups-busqueda-universal-lovable-prompt.md` | Búsqueda universal/memoria: preguntá en lenguaje natural sobre todo, con fuentes. |
| `devups-conexion-conversaciones-lovable-prompt.md` | Une el mismo contacto entre canales + surface proactivo del asset relacionado. |
| `devups-perfil-contacto-360-lovable-prompt.md` | Perfil 360 del contacto + preparación automática antes de reuniones. |
| `devups-briefing-diario-lovable-prompt.md` | Briefing matutino priorizado: lo que importa primero. |
| `devups-asistente-voz-lovable-prompt.md` | Asistente "Ask" por voz y texto sobre todo el sistema. |
| `devups-auto-etiquetado-temas-lovable-prompt.md` | Auto-etiquetado de conversaciones por tema. |
| `devups-modulo-documentos-lovable-prompt.md` | **Este hub de documentos** (auto-organiza propuestas, contratos, shortlists, etc.). |

## E · Equipo & Gobierno
| Documento | Qué es |
|---|---|
| `devups-modulo-equipo-permisos-lovable-prompt.md` | Multi-usuario: roles, un buzón por miembro, visibilidad por RLS. |
| `devups-modulo-whatsapp-lovable-prompt.md` | Agente de operaciones en WhatsApp (número dedicado): avisa, comandos, log. |
| `devups-analytics-ab-lovable-prompt.md` | Analytics de conversión + A/B testing. |
| `devups-gobierno-datos-lovable-prompt.md` | Gobierno: CRM fuente de verdad, loop de ICP, agent-ops, privacidad/DSR. |

---

## Otros archivos del proyecto
- `gojiberry-selected-contacts.csv` — los 351 leads originales (ya importados al motor).
- Borradores en Gmail — la plantilla "Developers-As-A-Service" en EN/PT/ES (para descartar los de prueba antiguos).

> Cuando construyas el **Módulo de Documentos**, estos mismos archivos pueden vivir adentro como la categoría "Documentación del producto", auto-organizados por las mismas reglas.
