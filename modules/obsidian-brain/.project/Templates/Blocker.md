### BLOCKER-<% await tp.system.prompt("Numero de blocker (ej: 002)") %>: <% await tp.system.prompt("Titulo del problema") %>

type:: blocker
status:: open
impact:: <% await tp.system.prompt("Impacto (alto/medio/bajo)") %>
date:: <% tp.date.now("YYYY-MM-DD") %>

**Descripcion:**
<% await tp.system.prompt("Que paso, como se manifesto") %>

**Impacto:**
-

**Investigacion:**
1.

**Solucion:**
_(Completar cuando se resuelva)_

**Lecciones:**
-
