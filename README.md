# Bot Periodista para Liga NBA2K

Bot de Discord para una liga NBA2K de simulación completa con GMs reales. El bot actúa como un periodista: pregunta por DM a los GMs, guarda sus respuestas y publica noticias diarias en el canal configurado.

## Qué Hace

- Registra GMs y sus franquicias con comandos slash.
- Envía preguntas recurrentes por DM a GMs aleatorios.
- Guarda las respuestas cuando los GMs responden directamente al bot por DM.
- Permite que cualquier miembro filtre un rumor con `/rumor`, limitado a un rumor aceptado por día.
- Permite que cualquier miembro proponga una pregunta para un GM con `/pregunta`.
- Publica una noticia diaria con las respuestas pendientes.
- Usa OpenAI para redactar noticias más elaboradas si `OPENAI_API_KEY` está configurada.
- Si no hay clave de OpenAI, publica un resumen simple.
- Guarda los datos localmente en `data/league-journalist.json`.

## Configuración Local

1. Crea una aplicación y un bot en el Discord Developer Portal.
2. Activa `Message Content Intent` en la sección del bot. Es necesario para leer respuestas por DM.
3. Invita el bot a tu servidor con estos scopes:
   - `bot`
   - `applications.commands`
4. Asegúrate de que el bot puede ver los canales de contexto y tiene permiso para leer historial de mensajes.
5. Instala dependencias:

```bash
npm install
```

6. Crea el archivo de entorno:

```bash
cp .env.example .env
```

7. Rellena `.env` con el token del bot. Añade `DISCORD_GUILD_ID` durante pruebas para que los comandos aparezcan rápido en tu servidor.
8. Configura `BOT_ADMIN_USER_IDS` con tu ID de usuario de Discord para restringir `/gm` y `/periodista`.

9. Ejecuta el bot:

```bash
npm run dev
```

## Comandos de Discord

### Administración

Estos comandos solo los puede ejecutar el administrador del bot si `BOT_ADMIN_USER_IDS` está configurado. Si no está configurado, el bot mantiene el comportamiento anterior y permite usuarios con permiso `Manage Server`.

`/gm asignar usuario:@Usuario equipo:"Los Angeles Lakers"`  
Registra o actualiza un GM.

`/gm quitar usuario:@Usuario`  
Elimina a un GM del grupo activo.

`/gm lista`  
Muestra los GMs registrados.

`/periodista configurar`  
Configura el canal de noticias, canales de contexto, preguntas diarias, hora de preguntas, hora de publicación y zona horaria.

`/periodista preguntar-ahora`  
Envía preguntas inmediatamente a los GMs que llevan más tiempo sin ser preguntados, o a un GM concreto.

`/periodista publicar-ahora`  
Publica una noticia inmediatamente usando respuestas pendientes.

`/periodista estado`  
Muestra el estado actual del bot.

### Comunidad

`/rumor texto:"..." equipo:"Los Angeles Lakers"`  
Filtra un rumor a la redacción. Puede ser verdadero o falso, pero el bot rechaza abuso, spam o troleo obvio. Cada usuario puede enviar un rumor aceptado al día.

`/pregunta destino:@GM texto:"..."`  
Propone una pregunta para un GM registrado. El bot la modera y, si la acepta, la guarda para que el periodista pueda usarla a partir del día siguiente.

## Flujo Recomendado de Pruebas

1. Configura el canal de noticias:

```text
/periodista configurar canal_noticias:#noticias canal_contexto_1:#noticias canal_contexto_2:#transacciones horas_contexto:48 preguntas_diarias:1 hora_preguntas:10 hora_publicacion:21 zona_horaria:Europe/Madrid
```

2. Regístrate como GM de prueba:

```text
/gm asignar usuario:@TuUsuario equipo:"Los Angeles Lakers"
```

3. Comprueba el estado:

```text
/periodista estado
```

4. Lanza una pregunta manual:

```text
/periodista preguntar-ahora usuario:@TuUsuario
```

5. Si el bot tiene `OPENAI_API_KEY`, la pregunta tendrá en cuenta menciones recientes de tu equipo en los canales de contexto configurados.

6. Responde al DM del bot como si fueras el GM.

7. Publica una noticia manual:

```text
/periodista publicar-ahora
```

## Despliegue en Railway

Despliega este repositorio como un servicio Node.js con este comando de inicio:

```bash
npm start
```

Configura estas variables en Railway:

```env
DISCORD_TOKEN=token_raw_del_bot_de_discord
DISCORD_GUILD_ID=id_de_tu_servidor
BOT_ADMIN_USER_IDS=tu_id_de_usuario_de_discord
JOURNALIST_NAME=El Insider de la Liga
OPENAI_API_KEY=clave_opcional_de_openai
OPENAI_MODEL=gpt-5.4
```

`DISCORD_TOKEN` debe ser el token del bot desde Discord Developer Portal > Bot > Token. No uses el client secret, public key, application ID, URL OAuth, comillas ni el prefijo `Bot `.

Mantén el servicio de Railway con una sola réplica. Varias réplicas podrían enviar DMs duplicados y publicar noticias duplicadas.

Para obtener tu ID de usuario de Discord, activa Developer Mode en Discord, haz clic derecho sobre tu usuario y copia el ID. Si hay varios administradores, sepáralos por comas:

```env
BOT_ADMIN_USER_IDS=111111111111111111,222222222222222222
```

## Contexto Reciente

El bot puede leer los últimos mensajes de canales como `#noticias` y `#transacciones` para adaptar las preguntas a la actualidad de la liga.

Ejemplo:

```text
/periodista configurar canal_contexto_1:#noticias canal_contexto_2:#transacciones horas_contexto:48
```

Cuando envía una pregunta, el bot:

- Lee los mensajes recientes de esos canales.
- Busca menciones del equipo, nombre de franquicia, apodo del equipo o GM.
- Usa ese contexto para redactar una pregunta más específica si `OPENAI_API_KEY` está configurada.
- Si no hay contexto útil o no hay OpenAI configurado, usa el banco normal de preguntas.

El bot necesita permiso para ver esos canales y leer el historial de mensajes.

## Rumores y Preguntas de Comunidad

Los rumores aceptados se pasan a la redacción como material no verificado. Si se publican, el artículo debe tratarlos como rumores o ruido de mercado, no como hechos confirmados.

Las preguntas de comunidad no se envían inmediatamente. Si pasan el filtro, quedan en cola para el GM de destino y pueden usarse a partir del día siguiente cuando el periodista vaya a preguntar a ese equipo.

## Notas

- Los horarios usan la zona horaria configurada, por defecto `Europe/Madrid`.
- Por defecto el bot pregunta a las 10:00 y publica a las 21:00.
- Los GMs con una pregunta abierta sin responder no reciben otra pregunta para evitar acumular DMs.
- Cuando se pregunta a varios GMs, el bot prioriza a quienes llevan más tiempo sin recibir una pregunta, con desempate aleatorio.
- Puedes editar `config/questions.json` para adaptar el tono de las preguntas a tu liga.
