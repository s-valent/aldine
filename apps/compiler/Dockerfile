# Two selectable TeX Live schemes (build arg TEXLIVE_SCHEME=medium|full):
#
#   medium (default) — ~1 GB of packages plus a pinned set of extras real
#     papers commonly need. The slim self-host default.
#   full — everything on CTAN preinstalled (~9 GB on disk). Choose this when your
#     documents need packages beyond the pinned set:
#       ALDINE_TEXLIVE_SCHEME=full docker compose up -d --build
#
# The medium base is pinned by digest so tlmgr revisions are reproducible (a
# floating tag makes the snapshot-repository date below drift out of sync and
# the build fail). The digest must be OLDER than the snapshot date, never
# newer. The full base needs no tlmgr at build time (nothing to install), so
# it can float and mirror skew cannot bite.
ARG TEXLIVE_SCHEME=medium

FROM texlive/texlive:latest-medium@sha256:0a5aa82d0d9d6e3b3a25f87e221ef61d7c077e83639ab5065cf298b1a01ec00c AS texlive-medium

# Packages beyond scheme-medium that real papers commonly need
# (newtx fonts, cleveref, etc.). A dated tlnet snapshot (not a random CTAN
# mirror) because live mirrors regularly lag the texlive image's revisions,
# which makes `tlmgr install` fail with "remote database is older than the
# local installation". Bump the date together with the base-image digest.
RUN tlmgr option repository https://texlive.info/tlnet-archive/2026/07/18/tlnet/ \
    && tlmgr update --self \
    && tlmgr install newtx txfonts fontaxes lastpage titlesec xstring fancyhdr cleveref \
       enumitem wrapfig threeparttable placeins multirow doclicense algorithmicx xurl sttools acro translations

FROM texlive/texlive:latest-full AS texlive-full
# scheme-full already contains every CTAN package — nothing to install.

FROM texlive-${TEXLIVE_SCHEME} AS base

# Node.js for the compile service wrapper
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

# Warm biber's PAR self-extraction cache at build time. Cold extraction takes
# ~90s, which would blow the compile timeout on a user's very first biblatex
# compile — and the killed half-extracted cache then wedges every compile after.
RUN biber --version

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
