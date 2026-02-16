import { exchangeCodeAsync, makeRedirectUri, useAuthRequest } from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as React from 'react';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const discovery = {
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    revocationEndpoint: `https://github.com/settings/connections/applications`,
};

const TOKEN_KEY = 'github_access_token';

export function useGitHubAuth(clientId: string, clientSecret: string) {
    const [token, setToken] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    // This is the CRITICAL part for Android / Expo Go
    // We must use the proxy to get a valid https://auth.expo.io URL
    // instead of an exp:// URL that GitHub doesn't support.
    const redirectUri = makeRedirectUri({
        // For Expo Go, we omit the scheme to trigger the proxy
    });

    const [request, response, promptAsync] = useAuthRequest(
        {
            clientId: clientId,
            scopes: ['repo', 'user'],
            redirectUri: redirectUri,
        },
        discovery
    );

    // Load token on mount
    React.useEffect(() => {
        async function loadToken() {
            try {
                const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
                if (storedToken) {
                    setToken(storedToken);
                }
            } catch (e) {
                console.error('[GitHub Auth] Failed to load token', e);
            } finally {
                setIsLoading(false);
            }
        }
        loadToken();
    }, []);

    React.useEffect(() => {
        if (response?.type === 'success') {
            const { code } = response.params;
            handleExchangeCode(code);
        } else if (response?.type === 'error') {
            console.error('[GitHub Auth] Auth error:', response.error);
            setError(response.error?.message || 'Authentication failed');
        }
    }, [response]);

    async function handleExchangeCode(code: string) {
        setIsLoading(true);
        setError(null);
        try {
            const tokenResponse = await exchangeCodeAsync(
                {
                    clientId: clientId,
                    clientSecret: clientSecret,
                    code: code,
                    redirectUri: redirectUri,
                    extraParams: {
                        code_verifier: request?.codeVerifier || '',
                    },
                },
                discovery
            );

            if (tokenResponse.accessToken) {
                await SecureStore.setItemAsync(TOKEN_KEY, tokenResponse.accessToken);
                setToken(tokenResponse.accessToken);
            } else {
                setError('No access token received from GitHub');
            }
        } catch (e: any) {
            console.error('[GitHub Auth] Exchange failed:', e);
            if (Platform.OS === 'web') {
                setError('GitHub CORS error: Token exchange only works on Android/iOS (Native).');
            } else {
                setError(e.message || 'Failed to exchange code');
            }
        } finally {
            setIsLoading(false);
        }
    }

    async function logout() {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken(null);
    }

    return {
        token,
        isLoading,
        error,
        login: () => promptAsync(),
        logout,
        request,
        redirectUri,
    };
}
