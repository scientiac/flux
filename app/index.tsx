import axios from 'axios';
import { Buffer } from 'buffer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Appbar, Avatar, Button, Dialog, List, Paragraph, Portal, Searchbar, Surface, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';
import { useGitHubAuth } from '../hooks/use-github-auth';

// GitHub Credentials
const GITHUB_CLIENT_ID = 'Ov23liyp3zLl9TB1Clwd';
const GITHUB_CLIENT_SECRET = 'a03efac4eac7ca537543b68343a8bee65b6cb10b';

export default function Index() {
    const theme = useTheme();
    const router = useRouter();
    const { config, updateConfig, updateRepoConfig, isConfigLoading, hasAutoRedirected, setHasAutoRedirected, cachedRepos, setCachedRepos, showToast } = useAppContext();
    const { token, isLoading: isAuthLoading, error, login, logout } = useGitHubAuth(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET);

    const [repos, setRepos] = useState<any[]>(cachedRepos || []);
    const [isFetchingRepos, setIsFetchingRepos] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isBooting, setIsBooting] = useState(true);
    const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);

    useEffect(() => {
        if (!isConfigLoading) {
            setIsBooting(false);
            // Hide splash screen when config is loaded (or if we are waiting for repo fetch, handle it there)
            // But main logic: if we are staying on Index, we wait for repos.
        }
    }, [isConfigLoading]);

    const fetchRepos = useCallback(async (isManualRefresh = false) => {
        if (!token) {
            ExpoSplashScreen.hideAsync(); // If no token, show login immediately
            return;
        }
        if (isManualRefresh) setIsFetchingRepos(true);
        try {
            const response = await axios.get('https://api.github.com/user/repos', {
                headers: {
                    Authorization: `token ${token}`,
                },
                params: {
                    sort: 'updated',
                    per_page: 80, // Slightly reduced for speed
                },
            });

            // Smart Diff: Light check (length and first item ID)
            const newData = response.data;
            const hasChanged = newData.length !== (cachedRepos?.length || 0) ||
                (newData.length > 0 && newData[0].id !== cachedRepos?.[0]?.id);

            if (hasChanged) {
                setRepos(newData);
                await setCachedRepos(newData);
                console.log('[Index] Cache updated');
            }
        } catch (error) {
            console.error('Error fetching repos', error);
        } finally {
            if (isManualRefresh) setIsFetchingRepos(false);
            ExpoSplashScreen.hideAsync();
        }
    }, [token, cachedRepos, setCachedRepos]);

    useEffect(() => {
        if (token) fetchRepos();
    }, [token]);

    useEffect(() => {
        // Wait for both config and auth to be ready
        if (isConfigLoading || isAuthLoading) return;

        const isConfigured = config.repo && config.repoConfigs && config.repoConfigs[config.repo];

        if (token && isConfigured && !hasAutoRedirected) {
            setHasAutoRedirected(true);
            router.replace('/files');
            // We stay in booting state while redirecting
            return;
        }

        if (token && !isFetchingRepos) {
            // Background sync even if we have cache
            // fetchRepos(); // This is now handled by the new useEffect above
        }

        // Only stop booting if we are NOT redirecting
        // const timer = setTimeout(() => setIsBooting(false), 50); // This is now handled by the new useEffect above
        // return () => clearTimeout(timer);
    }, [token, isConfigLoading, isAuthLoading, config.repo, config.repoConfigs, hasAutoRedirected]);

    const filteredRepos = repos.filter(repo =>
        repo.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const configuredRepos = useMemo(() =>
        filteredRepos.filter(repo => !!(config.repoConfigs && config.repoConfigs[repo.full_name])),
        [filteredRepos, config.repoConfigs]
    );
    const unconfiguredRepos = useMemo(() =>
        filteredRepos.filter(repo => !(config.repoConfigs && config.repoConfigs[repo.full_name])),
        [filteredRepos, config.repoConfigs]
    );

    const handleRepoSelect = useCallback(async (repoPath: string) => {
        const isAlreadyConfigured = !!(config.repoConfigs && config.repoConfigs[repoPath]);
        await updateConfig({ repo: repoPath });

        if (isAlreadyConfigured) {
            router.push('/files');
        } else {
            // Check for flux.json in the repo root
            try {
                const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/flux.json`, {
                    headers: { Authorization: `token ${token}` }
                });

                if (response.data && response.data.content) {
                    const content = Buffer.from(response.data.content, 'base64').toString('utf8');
                    const repoConfig = JSON.parse(content);
                    await updateRepoConfig(repoPath, repoConfig);
                    showToast('Settings synced from GitHub', 'success');
                    router.push('/files');
                    return;
                }
            } catch (e: any) {
                // Not found or access error, proceed to manual config
                console.log('[Index] flux.json not found or error', e.message);
            }
            router.push('/config');
        }
    }, [config.repoConfigs, updateConfig, updateRepoConfig, router, token, showToast]);

    const handleRefresh = useCallback(() => fetchRepos(true), [fetchRepos]);

    const renderRepoItem = useCallback(({ item }: any) => (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 16, backgroundColor: theme.colors.surface }}>
            <TouchableRipple
                onPress={() => handleRepoSelect(item.full_name)}
                onLongPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push(`/advanced-files?repo=${item.full_name}`);
                }}
                rippleColor={theme.colors.onSurfaceVariant + '1F'}
                borderless={true}
                style={styles.ripple}
            >
                <List.Item
                    title={item.name}
                    titleStyle={{ fontWeight: '600' }}
                    description={item.description || 'No description provided'}
                    descriptionNumberOfLines={1}
                    left={props => (
                        <View style={styles.iconContainer}>
                            <List.Icon
                                {...props}
                                icon={item.private ? "lock-outline" : "earth"}
                                color={item.private ? theme.colors.secondary : theme.colors.primary}
                            />
                        </View>
                    )}
                    right={props => <List.Icon {...props} icon="chevron-right" color={theme.colors.outline} />}
                    style={[styles.listItem, { borderBottomWidth: 0 }]}
                />
            </TouchableRipple>
        </Surface>
    ), [handleRepoSelect, theme]);

    const repoKeyExtractor = useCallback((item: any) => item.id.toString(), []);

    // 1. Initial Launch / Redirecting
    if (isBooting || isConfigLoading || isAuthLoading || (token && !hasAutoRedirected && config.repo && config.repoConfigs && config.repoConfigs[config.repo])) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]} />
        );
    }

    // 2. Not Authenticated
    if (!token) {
        ExpoSplashScreen.hideAsync();
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <View style={styles.centerContent}>
                    <Avatar.Icon size={80} icon="github" style={{ backgroundColor: theme.colors.primaryContainer }} />
                    <Text variant="headlineMedium" style={styles.title}>Flux</Text>
                    <Text variant="bodyLarge" style={styles.subtitle}>
                        Connect your GitHub account to manage your site.
                    </Text>
                    <Button
                        mode="contained"
                        onPress={() => login()}
                        style={styles.loginButton}
                        contentStyle={styles.loginButtonContent}
                        loading={isAuthLoading && !token}
                        disabled={isAuthLoading && !token}
                    >
                        {isAuthLoading && !token ? 'Connecting...' : 'Connect GitHub'}
                    </Button>

                    {error && (
                        <View style={{ marginTop: 16, padding: 12, backgroundColor: theme.colors.errorContainer, borderRadius: 12 }}>
                            <Text style={{ color: theme.colors.error, textAlign: 'center' }}>{error}</Text>
                            <Button mode="text" onPress={() => login()} style={{ marginTop: 8 }}>Try Again</Button>
                        </View>
                    )}
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.Content title="Repositories" titleStyle={{ fontWeight: 'bold' }} />
                <Appbar.Action icon="logout" onPress={() => setLogoutDialogVisible(true)} />
            </Appbar.Header>

            <View style={styles.content}>
                <View style={styles.searchContainer}>
                    <Searchbar
                        placeholder="Filter your repos..."
                        onChangeText={setSearchQuery}
                        value={searchQuery}
                        style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
                        inputStyle={styles.searchbarInput}
                        selectionColor={theme.colors.primary}
                        icon="filter-variant"
                        elevation={0}
                    />
                </View>

                <FlatList
                    data={unconfiguredRepos}
                    keyExtractor={repoKeyExtractor}
                    contentContainerStyle={{ paddingBottom: 24 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={isFetchingRepos}
                            onRefresh={handleRefresh}
                            colors={[theme.colors.primary]}
                            progressBackgroundColor={theme.colors.surface}
                        />
                    }
                    ListHeaderComponent={configuredRepos.length > 0 ? (
                        <View style={{ marginBottom: 8 }}>
                            <Text variant="labelLarge" style={{ marginHorizontal: 20, marginTop: 8, marginBottom: 8, color: theme.colors.primary, fontWeight: '700', letterSpacing: 0.5 }}>Your Sites</Text>
                            {configuredRepos.map(item => (
                                <Surface key={item.id} elevation={2} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 16, backgroundColor: theme.colors.primaryContainer }}>
                                    <TouchableRipple
                                        onPress={() => handleRepoSelect(item.full_name)}
                                        onLongPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            router.push(`/advanced-files?repo=${item.full_name}`);
                                        }}
                                        rippleColor={theme.colors.onPrimaryContainer + '1F'}
                                        borderless={true}
                                        style={styles.ripple}
                                    >
                                        <List.Item
                                            title={item.name}
                                            titleStyle={{ fontWeight: '700', color: theme.colors.onPrimaryContainer }}
                                            description={item.description || 'No description provided'}
                                            descriptionStyle={{ color: theme.colors.onPrimaryContainer, opacity: 0.7 }}
                                            descriptionNumberOfLines={1}
                                            left={props => (
                                                <View style={styles.iconContainer}>
                                                    <List.Icon
                                                        {...props}
                                                        icon={item.private ? "lock-outline" : "earth"}
                                                        color={theme.colors.onPrimaryContainer}
                                                    />
                                                </View>
                                            )}
                                            right={props => <List.Icon {...props} icon="chevron-right" color={theme.colors.onPrimaryContainer} />}
                                            style={[styles.listItem, { borderBottomWidth: 0 }]}
                                        />
                                    </TouchableRipple>
                                </Surface>
                            ))}
                            {unconfiguredRepos.length > 0 && (
                                <Text variant="labelLarge" style={{ marginHorizontal: 20, marginTop: 16, marginBottom: 4, color: theme.colors.outline, fontWeight: '700', letterSpacing: 0.5 }}>Other Repos</Text>
                            )}
                        </View>
                    ) : null}
                    renderItem={renderRepoItem}
                    ListEmptyComponent={configuredRepos.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Avatar.Icon size={64} icon="database-search" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>No repositories match your search.</Text>
                        </View>
                    ) : null}
                />
            </View>


            <Portal>
                <Dialog visible={logoutDialogVisible} onDismiss={() => setLogoutDialogVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Title>Logout</Dialog.Title>
                    <Dialog.Content>
                        <Paragraph>Are you sure you want to log out?</Paragraph>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setLogoutDialogVisible(false)}>Cancel</Button>
                        <Button onPress={() => { setLogoutDialogVisible(false); logout(); }}>Logout</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    title: {
        marginTop: 24,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    subtitle: {
        textAlign: 'center',
        marginTop: 12,
        opacity: 0.8,
        lineHeight: 22,
    },
    loginButton: {
        marginTop: 48,
        width: '100%',
        borderRadius: 28, // Rounded M3 style
    },
    loginButtonContent: {
        height: 56,
    },
    content: {
        flex: 1,
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },
    searchbar: {
        borderRadius: 28,
        backgroundColor: 'rgba(0,0,0,0.03)', // Subtle M3 look
        height: 52,
        elevation: 0, // Ensure no shadow
    },
    searchbarInput: {
        minHeight: 0,
        alignSelf: 'center',
    },
    ripple: {
        overflow: 'hidden',
    },
    listItem: {
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    iconContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 8,
    },
    emptyState: {
        flex: 1,
        padding: 64,
        alignItems: 'center',
        justifyContent: 'center',
    }
});
