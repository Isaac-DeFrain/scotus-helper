{
	description = "scotus-opinion-helper development shell";

	inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

	outputs = { nixpkgs, ... }:
		let
			systems = [
				"aarch64-darwin"
				"aarch64-linux"
				"x86_64-darwin"
				"x86_64-linux"
			];
		in
		{
			devShells = nixpkgs.lib.genAttrs systems (
				system:
				let
					pkgs = import nixpkgs { inherit system; };
				in
				{
					default = pkgs.mkShell {
						packages = with pkgs; [
							nodejs
							python3
							gnumake
							gcc
							pkg-config
							docker
							sqlitebrowser
						];
					};
				}
			);
		};
}
