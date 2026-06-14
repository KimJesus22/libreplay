# Ollama con pull de modelos al arrancar (F5, plan.md §6).
#
# Partimos de la imagen oficial (trae el binario y el runtime) y solo
# sustituimos el entrypoint por uno que, además de servir, baja los modelos del
# pipeline la primera vez. Pre-bajarlos en build dejaría la imagen con ~4 GB;
# mejor en el primer arranque, cacheados en el volumen (igual que infra/whisper).
FROM ollama/ollama

COPY entrypoint.sh /entrypoint.sh
# Normaliza saltos de línea a LF: en checkouts Windows (autocrlf) el script
# llega con CRLF y `sh` falla con "set: Illegal option" (el \r se cuela como
# argumento). `.gitattributes` ya fuerza LF, pero esto lo blinda en cualquier host.
RUN sed -i 's/\r$//' /entrypoint.sh
# La imagen oficial fija ENTRYPOINT ["/bin/ollama"]; lo reemplazamos por el
# script (que internamente llama a `ollama serve`).
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
