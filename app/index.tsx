import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Avatar, Button, List, Searchbar, Text, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';
import { useGitHubAuth } from '../hooks/use-github-auth';

// Replace with your real credentials from GitHub
const GITHUB_CLIENT_ID = 'Ov23liyp3zLl9TB1Clwd';
const GITHUB_CLIENT_SECRET = 'a03efac4eac7ca537543b68343a8bee65b6cb10b';

export default function Index() {
    const theme = useTheme();
    const router = useRouter();
    const { config, updateConfig } = useAppContext();
    const { token, isLoading, error, login, logout, redirectUri } = useGitHubAuth(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET);
    const [repos, setRepos] = useState<any[]>([]);
    const [isFetchingRepos, setIsFetchingRepos] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const fetchRepos = async () => {
        if (!token) return;
        setIsFetchingRepos(true);
        try {
            const response = await axios.get('https://api.github.com/user/repos', {
                headers: {
                    Authorization: `token ${token}`,
                },
                params: {
                    sort: 'updated',
                    per_page: 100,
                },
            });
            setRepos(response.data);
        } catch (error) {
            console.error('Error fetching repos', error);
        } finally {
            setIsFetchingRepos(false);
        }
    };

    useEffect(() => {
        if (token) {
            fetchRepos();
        }
    }, [token]);

    const filteredRepos = repos.filter(repo =>
        repo.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    if (!token) {
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
                        loading={isLoading && !token}
                        disabled={isLoading && !token}
                    >
                        {isLoading && !token ? 'Connecting...' : 'Connect GitHub'}
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
            <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
                <Appbar.Content title="My Repositories" titleStyle={{ fontWeight: 'bold' }} />
                <Appbar.Action icon="logout" onPress={logout} />
            </Appbar.Header>

            <View style={styles.content}>
                <Searchbar
                    placeholder="Filter your repos..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={styles.searchbar}
                    icon="filter-variant"
                />

                <FlatList
                    data={filteredRepos}
                    keyExtractor={(item) => item.id.toString()}
                    contentContainerStyle={{ paddingBottom: 24 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={isFetchingRepos}
                            onRefresh={fetchRepos}
                            colors={[theme.colors.primary]}
                            progressBackgroundColor={theme.colors.surfaceVariant}
                        />
                    }
                    renderItem={({ item }) => (
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
                            right={props => <List.Icon {...props} icon="chevron-right" />}
                            onPress={async () => {
                                await updateConfig({ repo: item.full_name });
                                router.push('/config');
                            }}
                            style={styles.listItem}
                        />
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Avatar.Icon size={64} icon="database-search" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>No repositories match your search.</Text>
                        </View>
                    }
                />
            </View>
        </View>
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
    searchbar: {
        margin: 16,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.02)', // Subtle M3 look
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
