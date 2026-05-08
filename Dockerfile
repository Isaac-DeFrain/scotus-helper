FROM nixos/nix:latest

WORKDIR /app

ENV NIX_CONFIG="experimental-features = nix-command flakes"

COPY flake.nix flake.lock package.json package-lock.json ./

RUN nix develop -c bash -lc "npm ci"

COPY . .

CMD ["nix", "develop", "-c", "npm", "run", "scrape-opinions", "--", "--all"]
