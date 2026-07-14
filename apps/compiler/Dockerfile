FROM texlive/texlive:latest-medium

# Node.js for the compile service wrapper
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

# Packages beyond scheme-medium that real papers commonly need
# (newtx fonts, cleveref, etc. — keeps the image ~1GB instead of full's ~3GB)
RUN tlmgr install newtx txfonts fontaxes lastpage titlesec xstring fancyhdr cleveref \
    enumitem wrapfig threeparttable placeins multirow doclicense algorithmicx xurl sttools acro translations \
    || tlmgr update --self && tlmgr install newtx txfonts fontaxes lastpage titlesec \
    xstring fancyhdr cleveref enumitem wrapfig threeparttable placeins multirow \
    doclicense algorithmicx xurl sttools acro translations

# Restricted (partial) shell-escape: allow only the vetted whitelist (epstopdf,
# kpsewhich, bibtex, …) so EPS auto-conversion works and the epstopdf warning
# goes away — but arbitrary \write18 commands stay blocked. Same posture as
# Overleaf/TeX Live default; safe alongside the no-egress + dropped-caps sandbox.
RUN tlmgr conf texmf shell_escape p

WORKDIR /srv
COPY server.js .

ENV PORT=4020 \
    DATA_DIR=/data \
    openin_any=p \
    openout_any=p

EXPOSE 4020
CMD ["node", "server.js"]
